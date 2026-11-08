import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { confirmCartHoldWorkflow } from "../workflows/confirm-cart-hold"

// Giỏ thành đơn → hold CONFIRMED (plan hot-stock HS-5). data.id là order id, không phải cart id.
export default async function hotStockConfirm({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const { result } = await confirmCartHoldWorkflow(container).run({ input: { order_id: data.id } })
  if (result !== "confirmed" && result !== "already_confirmed") {
    // Khách bỏ qua bước giữ hàng, hoặc hold đã hết hạn trước khi đơn được tạo (HS-6 xử lý ở IPN).
    container.resolve(ContainerRegistrationKeys.LOGGER).info(`hot-stock: order ${data.id} placed without an active hold (${result})`)
  }
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
