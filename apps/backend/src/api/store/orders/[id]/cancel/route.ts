import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  customerCancelOrderWorkflow,
  ORDER_NOT_CANCELLABLE,
  REFUND_FAILED,
} from "../../../../../workflows/customer-cancel-order"

// Khách huỷ đơn của chính mình khi còn "Chờ xác nhận" (API-6). Route chỉ chạy workflow.
// - Đơn lạ hoặc của khách khác: 404 (NOT_FOUND từ workflow, đi qua error handler của Medusa).
// - Không huỷ được (sai stage, còn fulfillment): 409 ORDER_NOT_CANCELLABLE.
// - Hoàn tiền thất bại: 502 REFUND_FAILED, đơn chưa bị huỷ.
// Error handler của Medusa ghi đè `code` của lỗi CONFLICT, nên hai mã trên route tự trả (verified-apis BE-4).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { errors } = await customerCancelOrderWorkflow(req.scope).run({
    input: { order_id: req.params.id, customer_id: req.auth_context.actor_id },
    throwOnError: false,
  })

  if (errors.length) {
    const error = errors[0].error
    if (error?.code === ORDER_NOT_CANCELLABLE) {
      return res.status(409).json({ code: ORDER_NOT_CANCELLABLE, type: "not_allowed", message: error.message })
    }
    if (error?.code === REFUND_FAILED) {
      return res.status(502).json({
        code: REFUND_FAILED,
        type: "refund_failed",
        message: "Hoàn tiền chưa thành công nên đơn chưa được huỷ. Vui lòng thử lại sau.",
      })
    }
    throw error
  }

  res.json({ order: { id: req.params.id, status: "canceled" } })
}
