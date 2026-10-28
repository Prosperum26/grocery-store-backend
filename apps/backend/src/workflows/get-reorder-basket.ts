import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { PastOrder, pickReorderItems, REORDER_LIMIT } from "../lib/predictive/reorder"

/**
 * BẢN TẠM cho giao diện "Có thể bạn cần mua lại" (BE-9), KHÔNG phải module Predictive.
 * Chọn món theo tần suất mua trong các đơn đã giao (lib/predictive/reorder.ts). Module Predictive
 * (LightGBM, AI #1) sẽ thay bước chọn món; hình dạng response (API-3) giữ nguyên để FE không phải sửa.
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
  quantity: number
  unit_price: number // giá đang tính, gồm khuyến mãi
  in_stock: boolean // còn đủ `quantity` tại kho
}

export type ReorderBasket = {
  status: "ready" | "empty" // module thật có thêm "warming" khi đang tính
  items: ReorderBasketItem[]
  total: number // tổng các món còn hàng, là số tiền của nút "Thêm tất cả"
}

const loadReorderBasketStep = createStep(
  "load-reorder-basket",
  async (input: { customer_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Đơn đã giao của khách. Stage đọc từ metadata (BE-6), không suy từ trạng thái Medusa.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata", "items.variant_id", "items.detail.quantity"],
      filters: { customer_id: input.customer_id },
    })
    const delivered: PastOrder[] = (orders as any[])
      .filter((o) => o.metadata?.stage === "DELIVERED")
      .map((o) => ({
        delivered_at: (o.metadata.stage_log ?? []).find((l: any) => l.stage === "DELIVERED")?.at ?? "",
        lines: (o.items ?? [])
          .filter((i: any) => i?.variant_id)
          .map((i: any) => ({ variant_id: i.variant_id, quantity: Number(i.detail?.quantity ?? 1) })),
      }))

    // 2. Xếp hạng trên mọi món đã mua, rồi bỏ món đã bị xoá hoặc đang ẩn (draft) và lấy 5 món đầu.
    const ranked = pickReorderItems(delivered, Number.MAX_SAFE_INTEGER)
    if (!ranked.length) {
      return new StepResponse<ReorderBasket>({ status: "empty", items: [], total: 0 })
    }
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "title",
        "manage_inventory",
        "product.id",
        "product.handle",
        "product.title",
        "product.status",
        "product.metadata",
        "calculated_price.calculated_amount",
        "inventory_items.required_quantity",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
      filters: { id: ranked.map((r) => r.variant_id) },
      context: { calculated_price: QueryContext({ currency_code: "vnd" }) },
    })
    const byId = new Map((variants as any[]).map((v) => [v.id, v]))

    const items: ReorderBasketItem[] = ranked
      .filter((r) => byId.get(r.variant_id)?.product?.status === "published")
      .slice(0, REORDER_LIMIT)
      .map((r) => {
        const v = byId.get(r.variant_id)
        return {
          variant_id: v.id,
          product_id: v.product.id,
          handle: v.product.handle,
          title: v.product.title,
          unit_label: v.title,
          art: v.product.metadata?.art ?? null,
          tint: v.product.metadata?.tint ?? null,
          quantity: r.quantity,
          unit_price: Number(v.calculated_price?.calculated_amount ?? 0),
          in_stock: availableOf(v) >= r.quantity,
        }
      })

    const total = items.filter((i) => i.in_stock).reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
    return new StepResponse<ReorderBasket>({ status: items.length ? "ready" : "empty", items, total })
  }
)

// Tồn khả dụng = tồn trừ hàng đang giữ, cộng mọi kho (hiện chỉ có Kho Q.7). Cùng công thức với chỉ mục
// tìm kiếm (search/helpers/stock.ts) nhưng tính theo biến thể. Không quản kho thì coi như luôn còn.
function availableOf(variant: any): number {
  if (variant.manage_inventory === false) {
    return Number.MAX_SAFE_INTEGER
  }
  const perItem = (variant.inventory_items ?? []).map((item: any) => {
    const total = (item.inventory?.location_levels ?? []).reduce(
      (sum: number, l: any) => sum + Number(l.stocked_quantity ?? 0) - Number(l.reserved_quantity ?? 0),
      0
    )
    return Math.floor(total / (item.required_quantity || 1))
  })
  return perItem.length ? Math.max(0, Math.min(...perItem)) : 0
}

export const getReorderBasketWorkflow = createWorkflow(
  "get-reorder-basket",
  (input: { customer_id: string }) => {
    return new WorkflowResponse(loadReorderBasketStep(input))
  }
)
