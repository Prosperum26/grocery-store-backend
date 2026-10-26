import type { VnpayOptions } from "../service"

// Giá trị giả cho test; secret thật chỉ nằm trong .env.
export const TEST_OPTIONS: VnpayOptions = {
  tmnCode: "TESTTMN1",
  hashSecret: "test-hash-secret-not-real",
  payUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  returnUrl: "http://localhost:8000/checkout/vnpay-return",
}
