import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../lib/ai/respond"
import { aiRecipeSearchWorkflow } from "../../../../workflows/ai-recipe-search"
import type { AiSearchBodyType } from "../search/validators"

// Trợ lý Bếp kèm lời giải thích của AI (API-8): StoreAiSearchRequest -> StoreAiCopilotResponse. Chậm hơn /search
// (vài giây). AI lỗi hay quá giờ thì vẫn trả `data` với `ai: null`. Hợp đồng: docs/contracts/ai-copilot.md.
export async function POST(req: MedusaStoreRequest<AiSearchBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiRecipeSearchWorkflow(req.scope).run({
      input: { mode: "copilot", body: req.validatedBody, sales_channel_ids: req.publishable_key_context.sales_channel_ids },
    })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
