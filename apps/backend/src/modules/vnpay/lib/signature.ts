import { createHmac, timingSafeEqual } from "crypto"

type Params = Record<string, unknown>

// Hai tham số này nằm trong query nhưng không được tính vào chuỗi ký.
const NOT_SIGNED = new Set(["vnp_SecureHash", "vnp_SecureHashType"])

/**
 * Chuỗi ký của VNPAY: các tham số vnp_* (bỏ giá trị rỗng) sắp xếp theo tên, mỗi cặp
 * `key=value` với value qua encodeURIComponent và %20 đổi thành "+" (dạng mẫu PHP/Java), nối bằng "&".
 * Cũng dùng làm query string của payment_url để hai bên luôn khớp nhau.
 * Lưu ý: PHP urlencode còn mã hoá `!'()*~`, encodeURIComponent thì không; các giá trị
 * của ta không chứa những ký tự này.
 */
export function buildSignData(params: Params): string {
  return Object.keys(params)
    .filter((key) => key.startsWith("vnp_") && !NOT_SIGNED.has(key))
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${encodeURIComponent(String(params[key])).replace(/%20/g, "+")}`)
    .join("&")
}

/** HMAC-SHA512 (hex, chữ thường) của chuỗi ký. */
export function signParams(params: Params, secret: string): string {
  return createHmac("sha512", secret).update(buildSignData(params)).digest("hex")
}

/** So chữ ký trong `vnp_SecureHash` với chữ ký tự tính; thiếu hoặc sai độ dài thì false. */
export function verifyParams(query: Params, secret: string): boolean {
  const given = query.vnp_SecureHash
  if (typeof given !== "string") {
    return false
  }
  const expected = Buffer.from(signParams(query, secret))
  const actual = Buffer.from(given.toLowerCase())
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
