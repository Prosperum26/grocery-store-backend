import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  setCartDeliverySlotWorkflow,
  SLOT_UNAVAILABLE,
} from "../../../../../workflows/set-cart-delivery-slot"
import type { SetDeliverySlotBodyType } from "./validators"

export async function POST(req: MedusaRequest<SetDeliverySlotBodyType>, res: MedusaResponse) {
  try {
    const { result: cart } = await setCartDeliverySlotWorkflow(req.scope).run({
      input: { cart_id: req.params.id, slot_id: req.validatedBody.slot_id },
    })
    res.json({ cart })
  } catch (e) {
    // Error handler của Medusa ghi đè `code` của mọi lỗi CONFLICT, nên tự trả 409 với mã riêng.
    if (MedusaError.isMedusaError(e) && e.code === SLOT_UNAVAILABLE) {
      res.status(409).json({ code: SLOT_UNAVAILABLE, type: e.type, message: e.message })
      return
    }
    throw e
  }
}
