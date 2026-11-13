import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { aiSuggestByProducts } from "../lib/ai/client"
import { buildVariantInfo } from "../lib/ai/attach-variants"
import { catalogIdsOfSuggestions, shapeSuggestions } from "../lib/ai/suggest"
import type { AiSuggestResponse, StoreAiSuggestByProductsRequest, StoreAiSuggestResponse } from "../types/ai"
import { getVariantStockWorkflow } from "./get-variant-stock"
import { loadVariantRowsStep } from "./ai-recipe-search"

/**
 * Gợi ý món từ các sản phẩm (B giỏ hàng, C trang sản phẩm): hỏi AI service, gắn biến thể, giá, tồn, rồi bỏ món
 * không mua được ngay. Hợp đồng: docs/contracts/ai-copilot.md, mục "Gợi ý món".
 */

// AI service xếp hạng nhiều hơn số món cần hiện, vì món hết hàng bị loại sau đó.
const AI_POOL = 9
const DEFAULT_KEEP = 3

const askSuggestStep = createStep("ask-ai-suggest-by-products", async (input: { body: StoreAiSuggestByProductsRequest }) => {
  const { catalog_ids, mode, exclude_ids } = input.body
  const data = await aiSuggestByProducts({ catalog_ids, mode, exclude_ids, limit: AI_POOL })
  return new StepResponse<AiSuggestResponse>(data)
})

export const aiSuggestByProductsWorkflow = createWorkflow(
  "ai-suggest-by-products",
  (input: { body: StoreAiSuggestByProductsRequest; sales_channel_ids: string[] }) => {
    const asked = askSuggestStep({ body: input.body })
    const rows = loadVariantRowsStep(transform({ asked }, ({ asked }) => ({ skus: catalogIdsOfSuggestions(asked) })))
    const stock = getVariantStockWorkflow.runAsStep({
      input: transform({ rows, input }, ({ rows, input }) => ({
        variant_ids: rows.map((row) => row.id),
        sales_channel_ids: input.sales_channel_ids,
      })),
    })
    const result = transform({ asked, rows, stock, input }, ({ asked, rows, stock, input }): StoreAiSuggestResponse => {
      const available = new Map(stock.map((s) => [s.variant_id, s.available]))
      return shapeSuggestions(asked, buildVariantInfo(rows, (id) => available.get(id)), input.body.limit ?? DEFAULT_KEEP)
    })
    return new WorkflowResponse(result)
  }
)
