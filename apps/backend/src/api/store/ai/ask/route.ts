import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { respondIfAiUnavailable } from "../../../../lib/ai/respond"
import { aiRecipeAskWorkflow } from "../../../../workflows/ai-recipe-detail"
import type { AiAskBodyType } from "./validators"

// Khách bấm "hỏi thêm" về món đang xem: AiAskRequest -> AiAskResponse. `answer` là null khi mô hình không trả lời được.
// Chậm (vài giây). Hợp đồng: docs/contracts/ai-copilot.md.
export async function POST(req: MedusaStoreRequest<AiAskBodyType>, res: MedusaResponse) {
  try {
    const { result } = await aiRecipeAskWorkflow(req.scope).run({ input: { body: req.validatedBody } })
    res.json(result)
  } catch (e) {
    respondIfAiUnavailable(res, e)
  }
}
