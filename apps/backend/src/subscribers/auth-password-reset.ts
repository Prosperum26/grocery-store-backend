import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { buildResetPasswordEmail, buildResetUrl } from "../lib/account/reset-password-email"

// Khách bấm "Quên mật khẩu" -> Medusa tạo token và phát auth.password_reset -> gửi email có link về storefront.
// Chỉ lo khách (actor_type "customer"); admin đặt lại mật khẩu bằng trang /app của Medusa, chưa cấu hình ở đây.
export default async function authPasswordReset({
  event: { data },
  container,
}: SubscriberArgs<{ entity_id: string; token: string; actor_type: string }>) {
  if (data.actor_type !== "customer") return

  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const storefrontUrl = process.env.STOREFRONT_URL || config.admin?.storefrontUrl || "http://localhost:8000"
  const mail = buildResetPasswordEmail(buildResetUrl(storefrontUrl, data.entity_id, data.token))

  const notifications = container.resolve(Modules.NOTIFICATION)
  await notifications.createNotifications({
    to: data.entity_id,
    channel: "email",
    template: "customer-reset-password",
    content: mail,
  })
}

export const config: SubscriberConfig = { event: "auth.password_reset" }
