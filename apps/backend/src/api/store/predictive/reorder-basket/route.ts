import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getReorderBasketWorkflow } from "../../../../workflows/get-reorder-basket"

// Giỏ "Có thể bạn cần mua lại" của khách đang đăng nhập (API-3). Bản tạm theo tần suất mua, xem workflow.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await getReorderBasketWorkflow(req.scope).run({
    input: { customer_id: req.auth_context.actor_id },
  })
  res.json(result)
}
