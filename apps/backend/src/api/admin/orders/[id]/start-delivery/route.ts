import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startDeliveryWorkflow } from "../../../../../workflows/start-delivery"

// Admin bấm "Bắt đầu giao": đơn phải ở PREPARING, nếu không workflow ném CONFLICT (409).
// Đơn không tồn tại thì 404. Route chỉ chạy workflow.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await startDeliveryWorkflow(req.scope).run({ input: { order_id: req.params.id } })
  res.json({ delivery: result })
}
