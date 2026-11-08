import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../lib/ai/respond"
import { aiRecipeDetailWorkflow } from "../../../../workflows/ai-recipe-detail"
import type { AiRecipeBodyType } from "./validators"

// Trợ lý Bếp, màn công thức: StoreAiRecipeRequest -> StoreAiRecipeResponse. Không dùng mô hình ngôn ngữ nên nhanh,
// storefront gọi lại mỗi khi khách đổi số người. 404 khi không có món. Hợp đồng: docs/contracts/ai-copilot.md.
export async function POST(req: MedusaStoreRequest<AiRecipeBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiRecipeDetailWorkflow(req.scope).run({
      input: { body: req.validatedBody, sales_channel_ids: req.publishable_key_context.sales_channel_ids },
    })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
