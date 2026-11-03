import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// API-3b: storefront gọi khi khách đăng nhập để tính trước giỏ "Mua lại" và không chờ kết quả.
// Bản tạm tính giỏ ngay khi GET reorder-basket nên ở đây chưa làm gì. Module Predictive sẽ chạy
// dự đoán và nạp sẵn vào Redis tại đây.
export async function POST(_req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.status(202).json({})
}
