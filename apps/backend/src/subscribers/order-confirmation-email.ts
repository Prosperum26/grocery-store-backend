import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { buildOrderEmail, slotText } from "../lib/account/order-email"
import { orderCode } from "../lib/order-code/order-code"

// Đơn mới đặt -> email xác nhận cho khách, qua provider email đã cấu hình (SMTP, hoặc chỉ ghi log khi chưa có
// SMTP_USER/SMTP_PASS). Lỗi gửi chỉ ghi log: email không được làm hỏng việc đặt đơn.
export default async function orderConfirmationEmail({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id", "display_id", "created_at", "email", "metadata",
        "item_subtotal", "shipping_total", "discount_total", "total",
        "items.product_title", "items.title", "items.variant_title", "items.quantity", "items.total",
        "shipping_address.first_name", "shipping_address.last_name", "shipping_address.address_1",
        "shipping_address.address_2", "shipping_address.city",
      ],
      filters: { id: data.id },
    })
    const order = orders[0] as any
    // Đơn demo của seed dùng địa chỉ @com4fud.demo (tên miền không có thật): không gửi, tránh thư báo trả về.
    if (!order?.email || order.email.endsWith(".demo")) return

    const a = order.shipping_address ?? {}
    const name = [a.last_name, a.first_name].filter(Boolean).join(" ").trim() || "bạn"
    // Mã hiển thị tính từ ngày tạo và display_id (cùng hàm với assign-order-code), không chờ subscriber kia.
    const code = order.metadata?.code || orderCode(new Date(order.created_at), Number(order.display_id))
    const storefront = (process.env.STOREFRONT_URL || "http://localhost:8000").replace(/\/+$/, "")

    const mail = buildOrderEmail({
      code,
      name,
      items: (order.items ?? []).map((i: any) => ({
        title: i.product_title || i.title,
        variant: i.variant_title || null,
        quantity: Number(i.quantity),
        total: Number(i.total),
      })),
      subtotal: Number(order.item_subtotal),
      shipping: Number(order.shipping_total),
      discount: Number(order.discount_total),
      total: Number(order.total),
      address: [a.address_1, a.address_2, a.city].filter(Boolean).join(", "),
      slot: slotText(order.metadata?.slot),
      note: order.metadata?.delivery_note || null,
      trackUrl: `${storefront}/vn/account/orders/details/${order.id}`,
    })

    await container.resolve(Modules.NOTIFICATION).createNotifications({
      to: order.email,
      channel: "email",
      template: "order-confirmation",
      content: mail,
    })
  } catch (e) {
    logger.warn(`order confirmation email for ${data.id} failed: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
