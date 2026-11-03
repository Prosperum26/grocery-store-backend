import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setOrderStageWorkflow } from "../../../../../workflows/set-order-stage"

// Admin bấm "Xác nhận" đơn: PENDING -> CONFIRMED. Đơn không ở trạng thái cho phép thì workflow ném
// INVALID_DATA (400), đơn không tồn tại thì 404.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await setOrderStageWorkflow(req.scope).run({
    input: { order_id: req.params.id, stage: "CONFIRMED", by: req.auth_context.actor_id },
  })
  res.json({ order: { id: req.params.id, metadata: result } })
}
