import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { loadReorderData } from "../../../../workflows/get-reorder-basket"

// API-3b: storefront gọi khi khách đăng nhập (không chờ kết quả). Trả 202 ngay, rồi tính thứ hạng "Mua lại" ở nền
// và lưu vào Redis (lib/predictive/cache.ts), nên lần mở trang chủ hay /mua-lai sau đó đọc cache thay vì gọi model.
// Khách chưa đủ lịch sử thì loadReorderData trả null mà không gọi AI.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context.actor_id
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  res.status(202).json({})
  loadReorderData(req.scope, customerId).catch((e) => logger.warn(`reorder pre-warm failed: ${(e as Error).message}`))
}
