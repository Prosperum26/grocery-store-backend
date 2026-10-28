import type { MedusaResponse } from "@medusajs/framework/http"

// Trả lời chung của các route Trợ lý Bếp khi AI service chưa nối vào (BE-10). Body đã được kiểm ở
// middlewares.ts, nên FE có thể gọi đúng hợp đồng ngay và hiện trạng thái "đang phát triển".
export const IN_DEVELOPMENT = "IN_DEVELOPMENT"

export function respondInDevelopment(res: MedusaResponse) {
  res.status(501).json({ code: IN_DEVELOPMENT, type: "not_implemented", message: "Đang trong quá trình phát triển" })
}
