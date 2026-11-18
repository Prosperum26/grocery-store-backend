import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../../lib/ai/respond"
import { aiSuggestByProductsWorkflow } from "../../../../../workflows/ai-suggest-by-products"
import type { AiSuggestByProductsBodyType } from "./validators"

// Gợi ý món từ các sản phẩm (B giỏ hàng, C trang sản phẩm): StoreAiSuggestByProductsRequest -> StoreAiSuggestResponse.
// Không bắt đăng nhập. AI service lỗi thì 503 AI_UNAVAILABLE và storefront ẩn khối.
export async function POST(req: MedusaStoreRequest<AiSuggestByProductsBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiSuggestByProductsWorkflow(req.scope).run({
      input: { body: req.validatedBody, sales_channel_ids: req.publishable_key_context.sales_channel_ids },
    })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
