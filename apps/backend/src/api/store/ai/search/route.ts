import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respondInDevelopment } from "../../../../lib/ai/in-development"

// Trợ lý Bếp, tìm món và giỏ nguyên liệu (API-8). Hợp đồng: StoreAiSearchRequest -> StoreAiSearchResponse
// (src/types/ai.ts, docs/contracts/ai-copilot.md). Bản giữ chỗ (AI-0): nhóm AI sẽ nối AI service
// (POST /api/v1/search) và gắn biến thể, giá, tồn; tới lúc đó trả 501.
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  respondInDevelopment(res)
}
