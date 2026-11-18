import { buildPaymentUrl, sanitizeOrderInfo } from "../lib/url"
import { verifyParams } from "../lib/signature"
import { TEST_OPTIONS } from "./fixtures"

const input = { txnRef: "paysesU01ABCU1", amountVnd: 390000, orderInfo: "Thanh toan don hang" }
const paramsOf = (url: string) => Object.fromEntries(new URL(url).searchParams)

describe("buildPaymentUrl", () => {
  it("23:30 giờ VN: CreateDate theo UTC+7, ExpireDate sau 10 phút", () => {
    const p = paramsOf(buildPaymentUrl(TEST_OPTIONS, input, new Date("2026-10-26T16:30:00Z")))
    expect(p.vnp_CreateDate).toBe("20261026233000")
    expect(p.vnp_ExpireDate).toBe("20261026234000")
  })

  it("hạn thanh toán vượt nửa đêm giờ VN sang ngày sau", () => {
    const p = paramsOf(buildPaymentUrl(TEST_OPTIONS, input, new Date("2026-10-26T16:50:00Z")))
    expect(p.vnp_CreateDate).toBe("20261026235000")
    expect(p.vnp_ExpireDate).toBe("20261027000000")
  })

  it("00:00:01 giờ VN đã sang ngày mới", () => {
    const p = paramsOf(buildPaymentUrl(TEST_OPTIONS, input, new Date("2026-10-26T17:00:01Z")))
    expect(p.vnp_CreateDate).toBe("20261027000001")
  })

  it("tham số cố định và số tiền nhân 100", () => {
    const p = paramsOf(buildPaymentUrl(TEST_OPTIONS, input, new Date("2026-10-26T05:00:00Z")))
    expect(p).toMatchObject({
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: "TESTTMN1",
      vnp_Amount: "39000000",
      vnp_CurrCode: "VND",
      vnp_TxnRef: "paysesU01ABCU1",
      vnp_OrderType: "other",
      vnp_Locale: "vn",
      vnp_ReturnUrl: TEST_OPTIONS.returnUrl,
      vnp_IpAddr: "127.0.0.1",
    })
  })

  it("vnp_IpAddr lấy từ options khi có", () => {
    const url = buildPaymentUrl({ ...TEST_OPTIONS, ipAddr: "203.0.113.7" }, input, new Date())
    expect(paramsOf(url).vnp_IpAddr).toBe("203.0.113.7")
  })

  it("chữ ký trong URL hợp lệ với secret", () => {
    const url = buildPaymentUrl(TEST_OPTIONS, input, new Date("2026-10-26T05:00:00Z"))
    expect(verifyParams(paramsOf(url), TEST_OPTIONS.hashSecret)).toBe(true)
    expect(url.startsWith(TEST_OPTIONS.payUrl + "?")).toBe(true)
  })

  it("số tiền lẻ bị từ chối", () => {
    expect(() => buildPaymentUrl(TEST_OPTIONS, { ...input, amountVnd: 100.5 }, new Date())).toThrow()
  })
})

describe("sanitizeOrderInfo", () => {
  it("bỏ dấu tiếng Việt và ký tự đặc biệt", () => {
    expect(sanitizeOrderInfo("Thanh toán đơn hàng #C4F-01!")).toBe("Thanh toan don hang C4F01")
  })
})
