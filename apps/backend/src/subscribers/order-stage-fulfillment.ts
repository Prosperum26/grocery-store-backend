import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderStage } from "../lib/order-stage/apply-stage"

// Admin tạo fulfillment -> đang chuẩn bị hàng. Event này mang order_id trực tiếp.
export default async function orderStageFulfillment({
  event: { data },
  container,
}: SubscriberArgs<{ order_id: string; fulfillment_id: string }>) {
  await applyOrderStage(container, data.order_id, "PREPARING", OrderWorkflowEvents.FULFILLMENT_CREATED)
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.FULFILLMENT_CREATED }
