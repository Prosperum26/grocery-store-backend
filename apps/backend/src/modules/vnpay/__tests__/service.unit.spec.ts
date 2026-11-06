import { BigNumber, MedusaError, PaymentSessionStatus } from "@medusajs/framework/utils"
import { signParams, verifyParams } from "../lib/signature"
import { buildTxnRef } from "../lib/txn-ref"
import VnpayProviderService from "../service"
import { TEST_OPTIONS } from "./fixtures"

const SESSION_ID = "payses_01ABC"

const service = () => new VnpayProviderService({}, TEST_OPTIONS)

// Query IPN như VNPAY gửi, đã ký bằng secret test.
function ipnQuery(overrides: Record<string, string> = {}) {
  const params: Record<string, string> = {
    vnp_TmnCode: TEST_OPTIONS.tmnCode,
    vnp_Amount: "39000000",
    vnp_BankCode: "NCB",
    vnp_BankTranNo: "VNP14000001",
    vnp_CardType: "ATM",
    vnp_OrderInfo: "Thanh toan don hang",
    vnp_PayDate: "20261026233500",
    vnp_ResponseCode: "00",
    vnp_TransactionNo: "14000001",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: buildTxnRef(SESSION_ID, 1),
    ...overrides,
  }
  return { ...params, vnp_SecureHashType: "HmacSHA512", vnp_SecureHash: signParams(params, TEST_OPTIONS.hashSecret) }
}

const webhook = (data: Record<string, string>) => ({ data, rawData: "", headers: {} })

describe("VnpayProviderService.validateOptions", () => {
  it("ném lỗi khi thiếu tmnCode hoặc hashSecret", () => {
    expect(() => VnpayProviderService.validateOptions({ ...TEST_OPTIONS, tmnCode: "" })).toThrow(/tmnCode/)
    expect(() => VnpayProviderService.validateOptions({ ...TEST_OPTIONS, hashSecret: undefined })).toThrow(/hashSecret/)
  })

  it("đủ options thì không ném", () => {
    expect(() => VnpayProviderService.validateOptions(TEST_OPTIONS)).not.toThrow()
  })

  it("identifier là vnpay", () => {
    expect(VnpayProviderService.identifier).toBe("vnpay")
  })
})

describe("VnpayProviderService.getWebhookActionAndData", () => {
  it("00/00 và chữ ký đúng -> captured với đúng session_id và số đồng", async () => {
    const result = await service().getWebhookActionAndData(webhook(ipnQuery()))
    expect(result.action).toBe("captured")
    expect(result.data?.session_id).toBe(SESSION_ID)
    expect(result.data?.amount).toBeInstanceOf(BigNumber)
    expect(Number(result.data?.amount)).toBe(390000)
  })

  it("chữ ký sai -> not_supported", async () => {
    const query = { ...ipnQuery(), vnp_Amount: "39000001" }
    expect((await service().getWebhookActionAndData(webhook(query))).action).toBe("not_supported")
  })

  it("txn_ref sai dạng -> not_supported", async () => {
    const result = await service().getWebhookActionAndData(webhook(ipnQuery({ vnp_TxnRef: "khong-hop-le" })))
    expect(result.action).toBe("not_supported")
  })

  it("ResponseCode 24 (khách huỷ) -> failed", async () => {
    const query = ipnQuery({ vnp_ResponseCode: "24", vnp_TransactionStatus: "02" })
    const result = await service().getWebhookActionAndData(webhook(query))
    expect(result.action).toBe("failed")
    expect(result.data?.session_id).toBe(SESSION_ID)
  })

  it("ResponseCode 00 nhưng TransactionStatus khác 00 -> failed", async () => {
    const result = await service().getWebhookActionAndData(webhook(ipnQuery({ vnp_TransactionStatus: "01" })))
    expect(result.action).toBe("failed")
  })
})

describe("VnpayProviderService.initiatePayment", () => {
  const input = (data?: Record<string, unknown>) => ({
    amount: 390000,
    currency_code: "vnd",
    data,
    context: { idempotency_key: SESSION_ID },
  })

  it("trả id, txn_ref, attempt, payment_url và status pending", async () => {
    const out = await service().initiatePayment(input())
    expect(out.data).toMatchObject({ attempt: 1, status: "pending" })
    expect(out.id).toBe(out.data?.txn_ref)
    expect(out.data?.txn_ref).toBe(buildTxnRef(SESSION_ID, 1))
  })

  it("hai lần cho cùng session với attempt khác nhau -> hai txn_ref khác nhau", async () => {
    const first = await service().initiatePayment(input())
    const second = await service().initiatePayment(input({ attempt: first.data?.attempt }))
    expect(second.data?.attempt).toBe(2)
    expect(second.data?.txn_ref).not.toBe(first.data?.txn_ref)
  })

  it("payment_url có vnp_Amount ×100, ExpireDate = CreateDate + 10 phút, chữ ký hợp lệ", async () => {
    const out = await service().initiatePayment(input())
    const p = Object.fromEntries(new URL(out.data?.payment_url as string).searchParams)
    expect(p.vnp_Amount).toBe("39000000")
    const toMs = (s: string) =>
      Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))
    expect(toMs(p.vnp_ExpireDate) - toMs(p.vnp_CreateDate)).toBe(10 * 60 * 1000)
    expect(verifyParams(p, TEST_OPTIONS.hashSecret)).toBe(true)
  })

  it("thiếu idempotency_key (id phiên) thì ném lỗi", async () => {
    await expect(service().initiatePayment({ amount: 1000, currency_code: "vnd" })).rejects.toThrow()
  })
})

describe("VnpayProviderService vòng đời phiên", () => {
  it("authorizePayment chưa có dấu đã trả -> pending (không cho hoàn tất giỏ khi chưa thanh toán)", async () => {
    const out = await service().authorizePayment({ data: { txn_ref: "x", status: "pending" } })
    expect(out.status).toBe(PaymentSessionStatus.PENDING)
  })

  it("authorizePayment sau khi IPN đánh dấu paid -> authorized", async () => {
    const out = await service().authorizePayment({ data: { txn_ref: "x", paid: true } })
    expect(out.status).toBe(PaymentSessionStatus.AUTHORIZED)
  })

  it("updatePayment chưa trả: tăng attempt, đổi txn_ref và payment_url", async () => {
    const first = await service().initiatePayment({
      amount: 390000,
      currency_code: "vnd",
      context: { idempotency_key: SESSION_ID },
    })
    const updated = await service().updatePayment({
      amount: 400000,
      currency_code: "vnd",
      data: first.data,
      context: { idempotency_key: SESSION_ID },
    })
    expect(updated.data?.attempt).toBe(2)
    expect(updated.data?.txn_ref).not.toBe(first.data?.txn_ref)
    expect(new URL(updated.data?.payment_url as string).searchParams.get("vnp_Amount")).toBe("40000000")
  })

  it("updatePayment khi đã paid: giữ nguyên data", async () => {
    const data = { txn_ref: "x", attempt: 1, paid: true }
    const updated = await service().updatePayment({ amount: 390000, currency_code: "vnd", data })
    expect(updated.data).toEqual(data)
  })

  it("capturePayment trả lại data (VNPAY đã thu tiền lúc khách trả)", async () => {
    const data = { txn_ref: "x", paid: true }
    expect((await service().capturePayment({ data })).data).toEqual(data)
  })

})

describe("VnpayProviderService.refundPayment", () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    jest.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch)
  })
  afterEach(() => jest.restoreAllMocks())

  const vnpayReply = (body: Record<string, string>) =>
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body })

  // data của payment đã trả: phiên do initiatePayment tạo, IPN thêm paid và mã giao dịch VNPAY.
  async function paidPaymentData(): Promise<Record<string, unknown>> {
    const started = await service().initiatePayment({
      amount: 390000,
      currency_code: "vnd",
      context: { idempotency_key: SESSION_ID },
    })
    return { ...started.data, paid: true, vnp_transaction_no: "14000001", vnp_pay_date: "20261026233500" }
  }

  it("gọi API hoàn với txn_ref, mã giao dịch VNPAY, ngày tạo và số tiền gốc lấy từ payment_url", async () => {
    vnpayReply({ vnp_ResponseCode: "00", vnp_TransactionNo: "14000999" })
    const data = await paidPaymentData()
    const createDate = new URL(data.payment_url as string).searchParams.get("vnp_CreateDate")

    const out = await service().refundPayment({ amount: 390000, data })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      vnp_Command: "refund",
      vnp_TransactionType: "02",
      vnp_TxnRef: data.txn_ref,
      vnp_Amount: 39000000,
      vnp_TransactionNo: "14000001",
      vnp_TransactionDate: createDate,
    })
    expect(out.data).toMatchObject({ txn_ref: data.txn_ref, paid: true, vnp_refund_transaction_no: "14000999" })
  })

  it("hoàn một phần: số tiền nhỏ hơn số tiền gốc thì vnp_TransactionType là 03", async () => {
    vnpayReply({ vnp_ResponseCode: "00" })
    await service().refundPayment({ amount: 100000, data: await paidPaymentData() })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ vnp_TransactionType: "03" })
  })

  it("VNPAY trả mã lỗi -> MedusaError NOT_ALLOWED có mã trong message", async () => {
    vnpayReply({ vnp_ResponseCode: "95", vnp_Message: "Original transaction failed" })
    const failure = service().refundPayment({ amount: 390000, data: await paidPaymentData() })
    await expect(failure).rejects.toMatchObject({ type: MedusaError.Types.NOT_ALLOWED, message: expect.stringContaining("95") })
  })

  it("lỗi mạng -> MedusaError UNEXPECTED_STATE", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"))
    const failure = service().refundPayment({ amount: 390000, data: await paidPaymentData() })
    await expect(failure).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringContaining("ECONNRESET"),
    })
  })

  it("data thiếu txn_ref hoặc payment_url (không phải payment VNPAY hợp lệ) -> INVALID_DATA, không gọi mạng", async () => {
    await expect(service().refundPayment({ amount: 1000, data: {} })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
