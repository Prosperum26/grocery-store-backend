import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respondInDevelopment } from "../../../../lib/assistant/in-development"

// Tìm món theo nghĩa (API-8). Hợp đồng: RecipeSearchRequest -> RecipeSearchResponse (src/types/assistant.ts).
// Bản giữ chỗ: AI service (bge-m3 + pgvector) chưa nối vào nên trả 501.
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  respondInDevelopment(res)
}
