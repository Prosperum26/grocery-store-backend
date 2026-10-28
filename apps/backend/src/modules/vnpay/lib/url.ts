import { toVnpAmount } from "./amount"
import { buildSignData, signParams } from "./signature"

export type VnpayUrlOptions = {
  tmnCode: string
  hashSecret: string
  payUrl: string
  returnUrl: string
  ipAddr?: string
}

// D7: hết hạn thanh toán sau 15 phút; vnp_IpAddr cố định khi chạy sandbox.
const EXPIRE_MS = 15 * 60 * 1000
const DEFAULT_IP_ADDR = "127.0.0.1"

// Giờ VN = UTC+7. Dịch mốc 7 giờ rồi đọc theo UTC nên không phụ thuộc múi giờ của máy chạy.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/** Mốc ms UTC -> "yyyyMMddHHmmss" theo giờ VN. */
export function formatVnpDate(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().replace(/\D/g, "").slice(0, 14)
}

/** vnp_OrderInfo phải không dấu, không ký tự đặc biệt: chỉ giữ chữ, số, khoảng trắng. */
export function sanitizeOrderInfo(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
}

/** URL chuyển khách sang cổng VNPAY, đã ký. `now` truyền vào để test cố định giờ. */
export function buildPaymentUrl(
  options: VnpayUrlOptions,
  input: { txnRef: string; amountVnd: number; orderInfo?: string },
  now: Date
): string {
  const params = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: options.tmnCode,
    vnp_Amount: toVnpAmount(input.amountVnd),
    vnp_CurrCode: "VND",
    vnp_TxnRef: input.txnRef,
    vnp_OrderInfo: sanitizeOrderInfo(input.orderInfo ?? `Thanh toan don hang ${input.txnRef}`),
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_ReturnUrl: options.returnUrl,
    vnp_IpAddr: options.ipAddr ?? DEFAULT_IP_ADDR,
    vnp_CreateDate: formatVnpDate(now.getTime()),
    vnp_ExpireDate: formatVnpDate(now.getTime() + EXPIRE_MS),
  }
  return `${options.payUrl}?${buildSignData(params)}&vnp_SecureHash=${signParams(params, options.hashSecret)}`
}
