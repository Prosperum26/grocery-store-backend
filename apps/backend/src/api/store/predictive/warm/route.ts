import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// API-3b: storefront gọi khi khách đăng nhập để tính trước giỏ "Mua lại" và không chờ kết quả.
// Giỏ đang được tính ngay khi GET reorder-basket nên ở đây chưa làm gì. Khi có Redis, nạp sẵn dự đoán tại đây.
export async function POST(_req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.status(202).json({})
}
