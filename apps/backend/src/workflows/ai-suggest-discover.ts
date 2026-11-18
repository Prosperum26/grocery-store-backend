import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { aiSuggestDiscover } from "../lib/ai/client"
import { buildVariantInfo } from "../lib/ai/attach-variants"
import { catalogIdsOfSuggestions, discoverSeed, shapeSuggestions } from "../lib/ai/suggest"
import type { AiSuggestResponse, StoreAiDiscoverRequest, StoreAiSuggestResponse } from "../types/ai"
import { getVariantStockWorkflow } from "./get-variant-stock"
import { loadVariantRowsStep } from "./ai-recipe-search"

/**
 * "Thử món mới?" (A): chọn một món có vài nguyên liệu khách chưa từng mua. Backend đọc SKU trong các đơn đã giao của
 * khách (nếu có), AI service chọn món, rồi giống by-products: gắn biến thể, giá, tồn và bỏ món không mua được ngay.
 * Khách chưa đăng nhập hoặc chưa có đơn thì AI service chỉ chọn trong các món đã được kiểm kỹ nhất.
 */

// AI service chọn nhiều hơn số món cần hiện, vì món hết hàng bị loại sau đó. Khối chỉ hiện một món một lần.
const AI_POOL = 10
const KEEP = 1

// Đơn đã giao: stage đọc từ metadata (BE-6), như loadReorderData. Không gọi AI nên nhanh hơn dùng loadReorderData.
const loadPurchasedSkusStep = createStep("load-purchased-skus", async (input: { customer_id?: string }, { container }) => {
  if (!input.customer_id) {
    return new StepResponse<string[]>([])
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata", "items.variant_id"],
    filters: { customer_id: input.customer_id },
  })
  const variantIds = new Set<string>()
  for (const order of orders as any[]) {
    if (order.metadata?.stage !== "DELIVERED") continue
    for (const item of order.items ?? []) {
      if (item?.variant_id) variantIds.add(item.variant_id)
    }
  }
  if (variantIds.size === 0) {
    return new StepResponse<string[]>([])
  }
  const { data: variants } = await query.graph({ entity: "product_variant", fields: ["id", "sku"], filters: { id: [...variantIds] } })
  return new StepResponse<string[]>((variants as any[]).map((v) => v.sku).filter((sku): sku is string => !!sku))
})

const askDiscoverStep = createStep(
  "ask-ai-suggest-discover",
  async (input: { body: StoreAiDiscoverRequest; customer_id?: string; purchased: string[] }) => {
    const data = await aiSuggestDiscover({
      bought_catalog_ids: input.purchased,
      have: input.body.have ?? [],
      seed: discoverSeed(input.customer_id, new Date()),
      limit: AI_POOL,
      exclude_ids: input.body.exclude_ids ?? [],
    })
    return new StepResponse<AiSuggestResponse>(data)
  }
)

export const aiSuggestDiscoverWorkflow = createWorkflow(
  "ai-suggest-discover",
  (input: { body: StoreAiDiscoverRequest; customer_id?: string; sales_channel_ids: string[] }) => {
    const purchased = loadPurchasedSkusStep({ customer_id: input.customer_id })
    const asked = askDiscoverStep({ body: input.body, customer_id: input.customer_id, purchased })
    const rows = loadVariantRowsStep(transform({ asked }, ({ asked }) => ({ skus: catalogIdsOfSuggestions(asked) })))
    const stock = getVariantStockWorkflow.runAsStep({
      input: transform({ rows, input }, ({ rows, input }) => ({
        variant_ids: rows.map((row) => row.id),
        sales_channel_ids: input.sales_channel_ids,
      })),
    })
    const result = transform({ asked, rows, stock }, ({ asked, rows, stock }): StoreAiSuggestResponse => {
      const available = new Map(stock.map((s) => [s.variant_id, s.available]))
      return shapeSuggestions(asked, buildVariantInfo(rows, (id) => available.get(id)), KEEP)
    })
    return new WorkflowResponse(result)
  }
)
