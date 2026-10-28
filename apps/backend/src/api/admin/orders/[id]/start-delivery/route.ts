import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startDeliveryWorkflow } from "../../../../../workflows/start-delivery"
import type { StartDeliveryBodyType } from "./validators"

// Admin bấm "Bắt đầu giao" kèm tên tài xế và biển số (body kiểm ở middlewares.ts, thiếu thì 400).
// Đơn phải ở PREPARING, nếu không workflow ném CONFLICT (409). Đơn không tồn tại thì 404. Route chỉ chạy workflow.
export async function POST(req: AuthenticatedMedusaRequest<StartDeliveryBodyType>, res: MedusaResponse) {
  const { result } = await startDeliveryWorkflow(req.scope).run({
    input: { order_id: req.params.id, driver_name: req.validatedBody.driver_name, plate: req.validatedBody.plate },
  })
  res.json({ delivery: result })
}
