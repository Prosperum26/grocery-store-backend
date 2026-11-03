import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { respondInDevelopment } from "../../../../lib/assistant/in-development"

// Trợ lý Bếp (API-8). Hợp đồng: AssistantChatRequest -> AssistantReply (src/types/assistant.ts).
// Bản giữ chỗ: Gemini và các tool search_recipes, check_stock, add_to_cart chưa có nên trả 501.
export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  respondInDevelopment(res)
}
