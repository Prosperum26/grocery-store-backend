import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import { availableOf, VARIANT_STOCK_FIELDS } from "../lib/inventory/available"
import { fetchReorderRanking } from "../lib/predictive/ai-client"
import { basketKey, cachedRanking, historyVersion } from "../lib/predictive/cache"
import { POPULAR_DAYS, topSellingVariants } from "../lib/predictive/popular"
import { reorderCachePrefix, reorderCacheRedis } from "../lib/predictive/redis"
import {
  buildPredictRequest,
  hasReorderHistory,
  orderPlacedAt,
  PastOrder,
  REORDER_LIMIT,
  usualQuantities,
} from "../lib/predictive/reorder"

/**
 * Giỏ "Có thể bạn cần mua lại": model LightGBM của grocery-store-ai chọn món từ các đơn đã giao,
 * Medusa gắn giá, tồn kho và số lượng. AI service lỗi thì giỏ rỗng và khối gợi ý ẩn đi.
 * Không trả xác suất, chu kỳ hay lý do gợi ý (API-3).
 */

export type ReorderBasketItem = {
  variant_id: string
  product_id: string
  handle: string
  title: string
  unit_label: string // tên biến thể, ví dụ "Hộp 10 quả"
  art: string | null
  tint: string | null
  thumbnail: string | null // ảnh sản phẩm; null thì storefront vẽ hình minh họa
  quantity: number
  unit_price: number // giá đang tính, gồm khuyến mãi
  in_stock: boolean // còn đủ `quantity` tại kho
}

export type ReorderBasket = {
  status: "ready" | "empty"
  items: ReorderBasketItem[]
  total: number // tổng các món còn hàng, là số tiền của nút "Thêm tất cả"
  // model: món model chọn từ lịch sử của khách. popular: khách chưa đủ lịch sử, đây là món bán chạy gần đây.
  source: "model" | "popular"
}

export type ReorderData = {
  delivered: PastOrder[]
  ranked: ReorderBasketItem[] // món còn bán, theo thứ hạng của model; AI lỗi thì rỗng
  purchased: ReorderBasketItem[] // mọi món đã mua và còn bán
}

/** Dùng chung cho giỏ trang chủ và trang "Mua lại". Chưa đủ lịch sử thì null, không gọi AI. */
export async function loadReorderData(container: MedusaContainer, customerId: string): Promise<ReorderData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Đơn đã giao của khách. Stage đọc từ metadata (BE-6), không suy từ trạng thái Medusa.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "metadata", "items.variant_id", "items.detail.quantity"],
    filters: { customer_id: customerId },
  })
  const delivered: PastOrder[] = (orders as any[])
    .filter((o) => o.metadata?.stage === "DELIVERED")
    .map((o) => ({
      placed_at: orderPlacedAt(o.metadata.stage_log, o.created_at),
      lines: (o.items ?? [])
        .filter((i: any) => i?.variant_id)
        .map((i: any) => ({ variant_id: i.variant_id, quantity: Number(i.detail?.quantity ?? 1) })),
    }))
  if (!hasReorderHistory(delivered)) {
    return null
  }
  const quantities = usualQuantities(delivered)

  // 2. Mọi món đã mua, gồm cả danh mục để gửi model. Món đã xoá không có ở đây.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "title",
      "product.id",
      "product.handle",
      "product.title",
      "product.status",
      "product.thumbnail",
      "product.metadata",
      "product.categories.handle",
      "calculated_price.calculated_amount",
      ...VARIANT_STOCK_FIELDS,
    ],
    filters: { id: [...quantities.keys()] },
    context: { calculated_price: QueryContext({ currency_code: "vnd" }) },
  })
  const categoryOf = new Map<string, string>(
    (variants as any[])
      .filter((v) => v.product?.categories?.[0]?.handle)
      .map((v) => [v.id, v.product.categories[0].handle])
  )

  // 3. Món đang ẩn (draft) không gợi ý.
  const purchased: ReorderBasketItem[] = (variants as any[])
    .filter((v) => v.product?.status === "published")
    .map((v) => toBasketItem(v, quantities.get(v.id) ?? 1))
  const byId = new Map(purchased.map((item) => [item.variant_id, item]))

  // 4. Model xếp hạng (giữ trong Redis 30 phút, xem lib/predictive/cache.ts); bỏ món đã xoá hoặc đang ẩn.
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { ranking } = await cachedRanking(
    reorderCacheRedis(),
    basketKey(reorderCachePrefix(), customerId),
    historyVersion(delivered),
    () => fetchReorderRanking(buildPredictRequest(delivered, categoryOf), logger),
    (message) => logger.warn(message)
  )
  const ranked = ranking.flatMap((id) => byId.get(id) ?? [])

  return { delivered, ranked, purchased }
}

/** Một dòng biến thể (đọc bằng VARIANT_FIELDS) thành món của giỏ, với số lượng gợi ý. */
function toBasketItem(v: any, quantity: number): ReorderBasketItem {
  return {
    variant_id: v.id,
    product_id: v.product.id,
    handle: v.product.handle,
    title: v.product.title,
    unit_label: v.title,
    art: v.product.metadata?.art ?? null,
    tint: v.product.metadata?.tint ?? null,
    thumbnail: v.product.thumbnail ?? null,
    quantity,
    unit_price: Number(v.calculated_price?.calculated_amount ?? 0),
    in_stock: availableOf(v) >= quantity,
  }
}

/**
 * Khách chưa đủ lịch sử để model dự đoán: các món bán chạy trong POPULAR_DAYS ngày qua, còn bán và còn hàng,
 * mỗi món 1 phần (proposal: "không có lịch sử thì dùng top bán chạy của kho"). Không gọi AI.
 */
async function loadPopularItems(container: MedusaContainer, limit: number): Promise<ReorderBasketItem[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(Date.now() - POPULAR_DAYS * 24 * 3600 * 1000)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "items.variant_id", "items.quantity"],
    filters: { created_at: { $gte: since } },
  })
  const top = topSellingVariants(orders as any[])
  if (!top.length) {
    return []
  }
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "product.id", "product.handle", "product.title", "product.status", "product.thumbnail",
      "product.metadata", "calculated_price.calculated_amount", ...VARIANT_STOCK_FIELDS],
    filters: { id: top },
    context: { calculated_price: QueryContext({ currency_code: "vnd" }) },
  })
  const byId = new Map((variants as any[]).map((v) => [v.id, v]))
  return top
    .map((id) => byId.get(id))
    .filter((v) => v && v.product?.status === "published")
    .map((v) => toBasketItem(v, 1))
    .filter((item) => item.in_stock)
    .slice(0, limit)
}

/** Tổng các món còn hàng. */
export function inStockTotal(items: ReorderBasketItem[]): number {
  return items.filter((i) => i.in_stock).reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
}

const loadReorderBasketStep = createStep(
  "load-reorder-basket",
  async (input: { customer_id: string }, { container }) => {
    const data = await loadReorderData(container, input.customer_id)
    // Chưa đủ lịch sử (null): món bán chạy. Có lịch sử mà model lỗi (ranked rỗng): ẩn khối như trước, không đoán.
    const source: ReorderBasket["source"] = data ? "model" : "popular"
    const items = data ? data.ranked.slice(0, REORDER_LIMIT) : await loadPopularItems(container, REORDER_LIMIT)
    return new StepResponse<ReorderBasket>({
      status: items.length ? "ready" : "empty",
      items,
      total: inStockTotal(items),
      source,
    })
  }
)

export const getReorderBasketWorkflow = createWorkflow(
  "get-reorder-basket",
  (input: { customer_id: string }) => {
    return new WorkflowResponse(loadReorderBasketStep(input))
  }
)
