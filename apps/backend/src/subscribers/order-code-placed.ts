import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { assignOrderCodeWorkflow } from "../workflows/assign-order-code"

// Đơn mới đặt -> gán mã hiển thị C4F-YYMMDD-NNNN (FE đọc metadata.code, không có thì hiện #display_id).
export default async function orderCodePlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await assignOrderCodeWorkflow(container).run({ input: { order_id: data.id } })
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
