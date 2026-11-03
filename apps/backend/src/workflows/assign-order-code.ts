import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep, updateOrdersStep, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { orderCode } from "../lib/order-code/order-code"

// Kiểu sinh ra của query ghi display_id là chuỗi, cột trong DB là số: đổi bằng Number() khi ghép mã.
type OrderForCode = { id: string; display_id: number | string | null; created_at: string | Date; metadata: Record<string, any> | null }

// Dựng metadata có `code`, trộn vào metadata cũ. Đơn đã có mã (đơn demo, event order.placed đến lặp)
// thì trả null để không ghi gì.
const buildOrderCodeMetadataStep = createStep("build-order-code-metadata", async (order: OrderForCode) => {
  const metadata = order.metadata ?? {}
  if (typeof metadata.code === "string" && metadata.code) {
    return new StepResponse(null)
  }
  return new StepResponse({ ...metadata, code: orderCode(new Date(order.created_at), Number(order.display_id)) })
})

/**
 * Gán `metadata.code` (C4F-YYMMDD-NNNN) cho đơn mới đặt. Dùng **cùng khoá** với set-order-stage vì cả
 * hai chạy khi có order.placed và cùng ghi đè cả `metadata`: không khoá thì bên ghi sau làm mất trường
 * của bên kia.
 */
export const assignOrderCodeWorkflow = createWorkflow("assign-order-code", (input: { order_id: string }) => {
  const lockKey = transform({ input }, ({ input }) => `order-stage-${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })

  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: ["id", "display_id", "created_at", "metadata"],
    filters: { id: input.order_id },
    options: { throwIfKeyNotFound: true },
  })

  const metadata = buildOrderCodeMetadataStep(transform({ orders }, ({ orders }) => orders[0] as OrderForCode))

  when({ metadata }, ({ metadata }) => metadata !== null).then(() => {
    updateOrdersStep(transform({ metadata, input }, ({ metadata, input }) => ({
      selector: { id: input.order_id },
      update: { metadata: metadata! },
    })))
  })

  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(metadata)
})
