import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { FulfillmentWorkflowEvents } from "@medusajs/framework/utils"
import { applyOrderStageByFulfillment } from "../lib/order-stage/apply-stage"

// Tạo shipment -> đang giao. `data.id` là id fulfillment, không phải id đơn (V3).
export default async function orderStageShipment({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await applyOrderStageByFulfillment(container, data.id, "SHIPPING", FulfillmentWorkflowEvents.SHIPMENT_CREATED)
}

export const config: SubscriberConfig = { event: FulfillmentWorkflowEvents.SHIPMENT_CREATED }
