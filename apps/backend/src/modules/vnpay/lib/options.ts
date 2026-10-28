import type { VnpayOptions } from "../service"

// Đọc cấu hình VNPAY từ biến môi trường; medusa-config.ts đọc cùng các biến này cho provider.
// Secret thật chỉ nằm trong .env, không commit.
export function vnpayOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): VnpayOptions {
  if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) {
    throw new Error("VNPAY_TMN_CODE and VNPAY_HASH_SECRET must be set")
  }
  return {
    tmnCode: env.VNPAY_TMN_CODE,
    hashSecret: env.VNPAY_HASH_SECRET,
    payUrl: env.VNPAY_PAY_URL || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    returnUrl: env.VNPAY_RETURN_URL || "http://localhost:8000/checkout/vnpay-return",
    ipAddr: env.VNPAY_IP_ADDR || undefined,
    apiUrl: env.VNPAY_API_URL || undefined,
  }
}
