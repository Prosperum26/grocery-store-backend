import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { aiCopilot, aiSearch } from "../lib/ai/client"
import { attachVariants, buildVariantInfo, catalogIdsOf, type VariantRow } from "../lib/ai/attach-variants"
import type { AiCopilotResponse, AiSearchRequest, AiSearchResponse, StoreAiCopilotResponse, StoreAiSearchResponse } from "../types/ai"
import { getVariantStockWorkflow } from "./get-variant-stock"

/**
 * Trợ lý Bếp (API-8): hỏi AI service, rồi gắn phần bán hàng của Medusa (biến thể, giá, tồn) vào từng sản phẩm.
 * Hợp đồng: docs/contracts/ai-copilot.md. `mode: "search"` trả StoreAiSearchResponse (nhanh, không có lời AI);
 * `mode: "copilot"` trả StoreAiCopilotResponse. AI service chỉ biết catalog_id = sku của biến thể.
 */

type Mode = "search" | "copilot"
type Asked = { data: AiSearchResponse; copilot: AiCopilotResponse | null }

const askAiServiceStep = createStep("ask-ai-service", async (input: { mode: Mode; body: AiSearchRequest }) => {
  if (input.mode === "copilot") {
    const copilot = await aiCopilot(input.body)
    return new StepResponse<Asked>({ data: copilot.data, copilot })
  }
  return new StepResponse<Asked>({ data: await aiSearch(input.body), copilot: null })
})

// Giá đang tính (gồm khuyến mãi) theo cách giỏ "Mua lại" đã dùng: tiền tệ VND, không cần ngữ cảnh khách.
export const loadVariantRowsStep = createStep("load-ai-variant-rows", async (input: { skus: string[] }, { container }) => {
  if (!input.skus.length) {
    return new StepResponse<VariantRow[]>([])
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "title", "product.id", "product.handle", "product.title", "product.status", "product.thumbnail", "calculated_price.calculated_amount"],
    filters: { sku: input.skus },
    context: { calculated_price: QueryContext({ currency_code: "vnd" }) },
  })
  return new StepResponse<VariantRow[]>(data as unknown as VariantRow[])
})

export const aiRecipeSearchWorkflow = createWorkflow(
  "ai-recipe-search",
  (input: { mode: Mode; body: AiSearchRequest; sales_channel_ids: string[] }) => {
    const asked = askAiServiceStep({ mode: input.mode, body: input.body })
    const rows = loadVariantRowsStep(transform({ asked }, ({ asked }) => ({ skus: catalogIdsOf(asked.data) })))
    // Tồn đã trừ phần khách khác đang giữ, cùng nguồn với API-15 nên số hiện ở đây khớp badge tồn kho.
    const stock = getVariantStockWorkflow.runAsStep({
      input: transform({ rows, input }, ({ rows, input }) => ({
        variant_ids: rows.map((row) => row.id),
        sales_channel_ids: input.sales_channel_ids,
      })),
    })
    const result = transform({ asked, rows, stock }, ({ asked, rows, stock }): StoreAiSearchResponse | StoreAiCopilotResponse => {
      const available = new Map(stock.map((s) => [s.variant_id, s.available]))
      const data = attachVariants(asked.data, buildVariantInfo(rows, (id) => available.get(id)))
      return asked.copilot ? { ...asked.copilot, data } : data
    })
    return new WorkflowResponse(result)
  }
)
