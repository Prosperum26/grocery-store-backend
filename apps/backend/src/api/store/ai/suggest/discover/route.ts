import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../../lib/ai/respond"
import { aiSuggestDiscoverWorkflow } from "../../../../../workflows/ai-suggest-discover"
import type { AiDiscoverBodyType } from "./validators"

// "Thử món mới?" (A): StoreAiDiscoverRequest -> StoreAiSuggestResponse. Khách vãng lai dùng được (chọn trong các món đã
// kiểm kỹ nhất); đã đăng nhập thì AI service nhận SKU đã mua để chọn món có vài nguyên liệu mới.
export async function POST(req: MedusaStoreRequest<AiDiscoverBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiSuggestDiscoverWorkflow(req.scope).run({
      input: {
        body: req.validatedBody,
        customer_id: (req as any).auth_context?.actor_id || undefined,
        sales_channel_ids: req.publishable_key_context.sales_channel_ids,
      },
    })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
