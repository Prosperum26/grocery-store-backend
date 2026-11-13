// Nội dung email đặt lại mật khẩu của khách. Tách khỏi subscriber để test không cần container Medusa.

export type ResetPasswordEmail = { subject: string; html: string; text: string }

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Link về trang đặt mật khẩu của storefront. Token và email nằm trong query nên phải mã hóa. */
export function buildResetUrl(storefrontUrl: string, email: string, token: string): string {
  const base = storefrontUrl.replace(/\/+$/, "")
  return `${base}/vn/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
}

export function buildResetPasswordEmail(resetUrl: string): ResetPasswordEmail {
  const safeUrl = escapeHtml(resetUrl)
  return {
    subject: "Đặt lại mật khẩu Com4Fud",
    text: [
      "Chào bạn,",
      "",
      "Com4Fud nhận được yêu cầu đặt lại mật khẩu cho tài khoản này. Mở link dưới đây để chọn mật khẩu mới:",
      resetUrl,
      "",
      "Link dùng được trong thời gian ngắn. Nếu không phải bạn yêu cầu, cứ bỏ qua email này, mật khẩu cũ vẫn dùng bình thường.",
    ].join("\n"),
    html: [
      "<p>Chào bạn,</p>",
      "<p>Com4Fud nhận được yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút dưới đây để chọn mật khẩu mới:</p>",
      `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 20px;background:#1f6b3a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Đặt mật khẩu mới</a></p>`,
      `<p>Nếu nút không bấm được, dán link này vào trình duyệt:<br>${safeUrl}</p>`,
      "<p>Link dùng được trong thời gian ngắn. Nếu không phải bạn yêu cầu, cứ bỏ qua email này, mật khẩu cũ vẫn dùng bình thường.</p>",
    ].join(""),
  }
}
