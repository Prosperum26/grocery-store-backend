import { createHmac } from "crypto"
import { requestVnpayRefund } from "../lib/refund-client"
import { TEST_OPTIONS } from "./fixtures"

const OPTIONS = { ...TEST_OPTIONS, apiUrl: "https://sandbox.example/merchant_webapi/api/transaction" }
const NOW = new Date("2026-10-27T10:00:00Z") // 17:00:00 giờ VN

const REQUEST = {
  txnRef: "paysesU01ABCU1",
  amountVnd: 390000,
  originalAmountVnd: 390000,
  transactionDate: "20261026233000",
  transactionNo: "14000001",
  orderInfo: "Khach huy don",
  createBy: "Com4Fud",
}

const deps = (fetchFn: jest.Mock) => ({ fetch: fetchFn as unknown as typeof fetch, now: NOW, requestId: "REQ0001" })

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => body,
})

// Body mà client đã gửi trong lần gọi fetch đầu tiên.
const sentBody = (fetchFn: jest.Mock) => JSON.parse(fetchFn.mock.calls[0][1].body)

describe("requestVnpayRefund", () => {
  it("ResponseCode 00 -> { ok: true } kèm mã giao dịch hoàn của VNPAY", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ vnp_ResponseCode: "00", vnp_Message: "Refund Success", vnp_TransactionNo: "14000999", vnp_TransactionStatus: "05" })
    )
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))).resolves.toEqual({
      ok: true,
      transactionNo: "14000999",
    })
  })

  it.each([
    ["91", "Unable to find the transaction"],
    ["94", "Duplicate refund request"],
    ["95", "Original transaction failed"],
    ["97", "Invalid signature"],
  ])("ResponseCode %s -> { ok: false, code } và không ném lỗi", async (code, message) => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ vnp_ResponseCode: code, vnp_Message: message }))
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))).resolves.toEqual({ ok: false, code, message })
  })

  it("ResponseCode 00 nhưng TransactionStatus 09 (VNPAY từ chối hoàn) -> { ok: false, code: '09' }", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({ vnp_ResponseCode: "00", vnp_TransactionStatus: "09", vnp_Message: "Refund rejected" })
    )
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))).resolves.toMatchObject({ ok: false, code: "09" })
  })

  it("lỗi mạng -> ném lỗi (không biết VNPAY đã nhận hay chưa nên không được coi là thất bại êm)", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error("ECONNRESET"))
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))).rejects.toThrow(/ECONNRESET/)
  })

  it("HTTP không phải 2xx hoặc body không phải JSON -> ném lỗi", async () => {
    const http500 = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }))
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(http500))).rejects.toThrow(/500/)

    const notJson = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <")
      },
    })
    await expect(requestVnpayRefund(OPTIONS, REQUEST, deps(notJson))).rejects.toThrow()
  })

  it("gửi POST JSON tới apiUrl với đúng các trường; số tiền ×100; hoàn toàn phần là 02", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ vnp_ResponseCode: "00" }))
    await requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(OPTIONS.apiUrl)
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(sentBody(fetchFn)).toEqual({
      vnp_RequestId: "REQ0001",
      vnp_Version: "2.1.0",
      vnp_Command: "refund",
      vnp_TmnCode: OPTIONS.tmnCode,
      vnp_TransactionType: "02",
      vnp_TxnRef: REQUEST.txnRef,
      vnp_Amount: 39000000,
      vnp_OrderInfo: "Khach huy don",
      vnp_TransactionNo: "14000001",
      vnp_TransactionDate: "20261026233000",
      vnp_CreateBy: "Com4Fud",
      vnp_CreateDate: "20261027170000", // NOW theo giờ VN
      vnp_IpAddr: "127.0.0.1",
      vnp_SecureHash: expect.any(String),
    })
  })

  it("hoàn một phần (số tiền nhỏ hơn giao dịch gốc) là 03", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ vnp_ResponseCode: "00" }))
    await requestVnpayRefund(OPTIONS, { ...REQUEST, amountVnd: 100000 }, deps(fetchFn))
    expect(sentBody(fetchFn)).toMatchObject({ vnp_TransactionType: "03", vnp_Amount: 10000000 })
  })

  it("vnp_SecureHash = HMAC-SHA512 của 13 giá trị nối bằng '|' đúng thứ tự trong tài liệu", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ vnp_ResponseCode: "00" }))
    await requestVnpayRefund(OPTIONS, REQUEST, deps(fetchFn))
    const b = sentBody(fetchFn)

    // Thứ tự viết tay từ tài liệu, không dùng lại danh sách trong code.
    const data = [
      "REQ0001", "2.1.0", "refund", OPTIONS.tmnCode, "02", REQUEST.txnRef, "39000000", "14000001",
      "20261026233000", "Com4Fud", "20261027170000", "127.0.0.1", "Khach huy don",
    ].join("|")
    expect(b.vnp_SecureHash).toBe(createHmac("sha512", OPTIONS.hashSecret).update(data).digest("hex"))
  })

  it("thiếu transactionNo: ô rỗng vẫn nằm giữa hai dấu '|' và không gửi trường đó", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ vnp_ResponseCode: "00" }))
    await requestVnpayRefund(OPTIONS, { ...REQUEST, transactionNo: undefined }, deps(fetchFn))
    const b = sentBody(fetchFn)

    expect(b).not.toHaveProperty("vnp_TransactionNo")
    const data = [
      "REQ0001", "2.1.0", "refund", OPTIONS.tmnCode, "02", REQUEST.txnRef, "39000000", "",
      "20261026233000", "Com4Fud", "20261027170000", "127.0.0.1", "Khach huy don",
    ].join("|")
    expect(b.vnp_SecureHash).toBe(createHmac("sha512", OPTIONS.hashSecret).update(data).digest("hex"))
  })

  it("số tiền hoàn không hợp lệ (lẻ, không dương, lớn hơn giao dịch gốc) -> ném lỗi và không gọi mạng", async () => {
    const fetchFn = jest.fn()
    for (const amountVnd of [0, -1, 1000.5, 390001]) {
      await expect(requestVnpayRefund(OPTIONS, { ...REQUEST, amountVnd }, deps(fetchFn))).rejects.toThrow()
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
