import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { aiAsk, aiRecipe } from "../lib/ai/client"
import { attachBasket, buildVariantInfo, catalogIdsOfBaskets } from "../lib/ai/attach-variants"
import type { AiAskRequest, AiAskResponse, AiRecipeDetail, AiRecipeRequest, StoreAiRecipeResponse } from "../types/ai"
import { loadVariantRowsStep } from "./ai-recipe-search"
import { getVariantStockWorkflow } from "./get-variant-stock"

/**
 * Màn công thức của Trợ lý Bếp (hợp đồng: docs/contracts/ai-copilot.md).
 * - ai-recipe-detail: hỏi AI service /recipe rồi gắn biến thể, giá, tồn vào giỏ (cùng cách với ai-recipe-search).
 * - ai-recipe-ask: chuyển câu hỏi thêm của khách tới AI service /ask; chỉ chạy khi khách bấm nút.
 */

const fetchRecipeStep = createStep("ask-ai-service-recipe", async (input: { body: AiRecipeRequest }) => {
  return new StepResponse<AiRecipeDetail>(await aiRecipe(input.body))
})

export const aiRecipeDetailWorkflow = createWorkflow(
  "ai-recipe-detail",
  (input: { body: AiRecipeRequest; sales_channel_ids: string[] }) => {
    const detail = fetchRecipeStep({ body: input.body })
    const rows = loadVariantRowsStep(transform({ detail }, ({ detail }) => ({ skus: catalogIdsOfBaskets([detail.basket]) })))
    const stock = getVariantStockWorkflow.runAsStep({
      input: transform({ rows, input }, ({ rows, input }) => ({
        variant_ids: rows.map((row) => row.id),
        sales_channel_ids: input.sales_channel_ids,
      })),
    })
    const result = transform({ detail, rows, stock }, ({ detail, rows, stock }): StoreAiRecipeResponse => {
      const available = new Map(stock.map((s) => [s.variant_id, s.available]))
      return { ...detail, basket: attachBasket(detail.basket, buildVariantInfo(rows, (id) => available.get(id))) }
    })
    return new WorkflowResponse(result)
  }
)

const askStep = createStep("ask-ai-service-ask", async (input: { body: AiAskRequest }) => {
  return new StepResponse<AiAskResponse>(await aiAsk(input.body))
})

export const aiRecipeAskWorkflow = createWorkflow("ai-recipe-ask", (input: { body: AiAskRequest }) => {
  return new WorkflowResponse(askStep({ body: input.body }))
})
