/**
 * Trang return có được xác nhận thanh toán như IPN không.
 *
 * VNPAY gọi IPN từ máy chủ của họ tới địa chỉ HTTPS công khai đã đăng ký; backend chạy ở localhost thì IPN không bao
 * giờ tới và đơn không được tạo. Tham số VNPAY gửi kèm khi đưa khách về trang return được ký bằng cùng khoá, nên
 * kiểm chữ ký xong thì đáng tin như IPN, và handleIpn chạy lặp vẫn an toàn. Rủi ro còn lại chỉ là trang return phụ
 * thuộc trình duyệt khách (đóng tab thì không có), nên IPN vẫn là đường chính.
 *
 * VNPAY_RETURN_AS_IPN=true/false đặt rõ; không đặt thì bật khi không phải production (dev, sandbox).
 */
export function returnConfirmsPayment(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.VNPAY_RETURN_AS_IPN?.trim().toLowerCase()
  if (flag === "true") return true
  if (flag === "false") return false
  return env.NODE_ENV !== "production"
}
