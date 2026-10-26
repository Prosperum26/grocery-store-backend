import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { FulfillmentWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderStageByFulfillment } from "../lib/order-stage/apply-stage"

// Đánh dấu đã giao. `data.id` là id fulfillment, không phải id đơn (V3).
export default async function orderStageDelivered({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await applyOrderStageByFulfillment(container, data.id, "DELIVERED", FulfillmentWorkflowEvents.DELIVERY_CREATED)
}

export const config: SubscriberConfig = { event: FulfillmentWorkflowEvents.DELIVERY_CREATED }
