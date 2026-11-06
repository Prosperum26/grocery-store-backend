import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../lib/ai/respond"
import { aiRecipeSearchWorkflow } from "../../../../workflows/ai-recipe-search"
import type { AiSearchBodyType } from "./validators"

// Trợ lý Bếp, tìm món và giỏ nguyên liệu (API-8): StoreAiSearchRequest -> StoreAiSearchResponse.
// Nhanh vì không dùng mô hình ngôn ngữ. Hợp đồng: docs/contracts/ai-copilot.md. Không bắt đăng nhập.
export async function POST(req: MedusaStoreRequest<AiSearchBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiRecipeSearchWorkflow(req.scope).run({
      input: { mode: "search", body: req.validatedBody, sales_channel_ids: req.publishable_key_context.sales_channel_ids },
    })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
