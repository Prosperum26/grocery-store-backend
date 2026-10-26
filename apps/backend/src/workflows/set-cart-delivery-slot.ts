import { MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { updateCartsStep, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { listSlots } from "../lib/delivery/slots"

// Mã lỗi trả cho storefront khi khung giờ đã qua hoặc quá sát giờ bắt đầu.
export const SLOT_UNAVAILABLE = "SLOT_UNAVAILABLE"

// Tìm khung theo id trong các khung hiện hành, tính theo giờ hiện tại.
const pickDeliverySlotStep = createStep(
  "pick-delivery-slot",
  async (input: { slot_id: string }) => {
    const slot = listSlots(new Date()).find((s) => s.id === input.slot_id)
    if (!slot) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Delivery slot ${input.slot_id} was not found`)
    }
    if (!slot.available) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Delivery slot ${input.slot_id} is no longer available`,
        SLOT_UNAVAILABLE
      )
    }
    // `available` đổi theo thời gian nên không lưu vào giỏ.
    const { available: _available, ...chosen } = slot
    return new StepResponse(chosen)
  }
)

export const setCartDeliverySlotWorkflow = createWorkflow(
  "set-cart-delivery-slot",
  (input: { cart_id: string; slot_id: string }) => {
    // Giỏ không tồn tại -> lỗi not_found (404).
    const { data: carts } = useQueryGraphStep({
      entity: "cart",
      fields: ["id", "metadata"],
      filters: { id: input.cart_id },
      options: { throwIfKeyNotFound: true },
    })

    const slot = pickDeliverySlotStep({ slot_id: input.slot_id })

    // Giữ các khoá metadata khác của giỏ (ví dụ delivery_note), chỉ ghi đè `slot`.
    const updates = transform({ carts, slot, input }, ({ carts, slot, input }) => [
      { id: input.cart_id, metadata: { ...(carts[0].metadata ?? {}), slot } },
    ])
    const updated = updateCartsStep(updates)

    return new WorkflowResponse(transform({ updated }, ({ updated }) => updated[0]))
  }
)
