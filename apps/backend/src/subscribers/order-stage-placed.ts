import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderStage } from "../lib/order-stage/apply-stage"

// Giỏ hoàn tất -> đơn mới đặt (completeCartWorkflow phát event này; createOrderWorkflow thì không).
export default async function orderStagePlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await applyOrderStage(container, data.id, "PENDING", OrderWorkflowEvents.PLACED)
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
