import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderStage } from "../lib/order-stage/apply-stage"

// Đơn bị huỷ. Chỉ hợp lệ từ PENDING | CONFIRMED | PREPARING; còn lại bị từ chối và chỉ log cảnh báo.
export default async function orderStageCanceled({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await applyOrderStage(container, data.id, "CANCELLED", OrderWorkflowEvents.CANCELED)
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.CANCELED }
