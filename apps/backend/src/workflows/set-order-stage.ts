import { MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep, updateOrdersStep, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { canTransition, type OrderStage } from "../lib/order-stage/stages"

export type SetOrderStageInput = { order_id: string; stage: OrderStage; by?: string }

// Kiểm tra bước chuyển và dựng metadata mới: trộn vào metadata cũ (không thay), đặt `stage` và nối
// một mục vào `stage_log`. Không hợp lệ thì ném INVALID_DATA, không ghi gì.
const buildStageMetadataStep = createStep(
  "build-order-stage-metadata",
  async (input: { metadata: Record<string, any> | null; stage: OrderStage; by?: string }) => {
    const metadata = input.metadata ?? {}
    const from: OrderStage | undefined = metadata.stage
    if (!canTransition(from, input.stage)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order cannot move from ${from ?? "no stage"} to ${input.stage}`
      )
    }
    const log = Array.isArray(metadata.stage_log) ? metadata.stage_log : []
    return new StepResponse({
      ...metadata,
      stage: input.stage,
      stage_log: [...log, { stage: input.stage, at: new Date().toISOString(), by: input.by ?? "system" }],
    })
  }
)

/**
 * Đổi `metadata.stage` của đơn theo D2. Khoá theo đơn để hai event đến sát nhau (ví dụ shipment rồi
 * delivery) không ghi đè `stage_log` của nhau.
 */
export const setOrderStageWorkflow = createWorkflow("set-order-stage", (input: SetOrderStageInput) => {
  const lockKey = transform({ input }, ({ input }) => `order-stage-${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })

  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: input.order_id },
    options: { throwIfKeyNotFound: true },
  })

  const metadata = buildStageMetadataStep(
    transform({ orders, input }, ({ orders, input }) => ({
      metadata: orders[0].metadata as Record<string, any> | null,
      stage: input.stage,
      by: input.by,
    }))
  )

  // updateOrdersStep ghi thẳng vào order module, không phát order.updated.
  updateOrdersStep(transform({ metadata, input }, ({ metadata, input }) => ({
    selector: { id: input.order_id },
    update: { metadata },
  })))

  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(metadata)
})
