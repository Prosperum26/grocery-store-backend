import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getReorderScheduleWorkflow } from "../../../../workflows/get-reorder-schedule"

// Dữ liệu trang "Mua lại" của khách đang đăng nhập: top 10 hôm nay và số ngày ước tính của các món khác.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await getReorderScheduleWorkflow(req.scope).run({
    input: { customer_id: req.auth_context.actor_id },
  })
  res.json(result)
}
