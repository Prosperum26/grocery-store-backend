import { createHmac } from "crypto"
import { signParams, verifyParams } from "../lib/signature"

const SECRET = "test-hash-secret-not-real"

describe("vnpay signature", () => {
  it("ký trên chuỗi key sắp xếp, value encodeURIComponent với %20 -> +, HMAC-SHA512 hex", () => {
    const expected = createHmac("sha512", SECRET).update("vnp_A=1&vnp_B=a+b%26c").digest("hex")
    expect(signParams({ vnp_B: "a b&c", vnp_A: 1 }, SECRET)).toBe(expected)
  })

  it("bỏ giá trị rỗng và khoá không bắt đầu bằng vnp_", () => {
    const base = signParams({ vnp_A: "1" }, SECRET)
    expect(signParams({ vnp_A: "1", vnp_Empty: "", other: "x" }, SECRET)).toBe(base)
  })

  it("verifyParams: đúng chữ ký -> true", () => {
    const params = { vnp_Amount: "39000000", vnp_TxnRef: "abc", vnp_ResponseCode: "00" }
    expect(verifyParams({ ...params, vnp_SecureHash: signParams(params, SECRET) }, SECRET)).toBe(true)
  })

  it("verifyParams: không tính vnp_SecureHash và vnp_SecureHashType vào chuỗi ký", () => {
    const params = { vnp_Amount: "39000000", vnp_TxnRef: "abc" }
    const query = { ...params, vnp_SecureHashType: "HmacSHA512", vnp_SecureHash: signParams(params, SECRET) }
    expect(verifyParams(query, SECRET)).toBe(true)
  })

  it("đổi một tham số -> false", () => {
    const params = { vnp_Amount: "39000000", vnp_TxnRef: "abc" }
    const hash = signParams(params, SECRET)
    expect(verifyParams({ ...params, vnp_Amount: "39000001", vnp_SecureHash: hash }, SECRET)).toBe(false)
  })

  it("đổi secret -> false", () => {
    const params = { vnp_Amount: "39000000", vnp_TxnRef: "abc" }
    expect(verifyParams({ ...params, vnp_SecureHash: signParams(params, SECRET) }, "secret-khac")).toBe(false)
  })

  it("thiếu vnp_SecureHash hoặc hash sai độ dài -> false, không ném lỗi", () => {
    expect(verifyParams({ vnp_Amount: "1" }, SECRET)).toBe(false)
    expect(verifyParams({ vnp_Amount: "1", vnp_SecureHash: "abc" }, SECRET)).toBe(false)
  })

  it("không phân biệt hoa thường của hash hex", () => {
    const params = { vnp_Amount: "1" }
    expect(verifyParams({ ...params, vnp_SecureHash: signParams(params, SECRET).toUpperCase() }, SECRET)).toBe(true)
  })
})
