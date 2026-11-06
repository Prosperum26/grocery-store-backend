import { MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { cartHoldLines, type CartHoldLine, type CartItemForHold } from "../lib/inventory/cart-hold-lines"
import { syncItemsFromPostgres } from "../lib/inventory/stock-levels"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"
import type { ReserveResult } from "../modules/hot-stock/service"

export const OUT_OF_STOCK = "OUT_OF_STOCK"
export const CART_COMPLETED = "CART_COMPLETED"

/** Món thiếu hàng trả cho storefront (API-14). `available` đã tính cả phần giỏ này đang giữ. */
export type StockShortage = { variant_id: string; inventory_item_id: string; requested: number; available: number }

export type ReserveCartStockResult =
  | { status: "held"; hold: { cart_id: string; status: "HELD"; expires_at: string } }
  | { status: "out_of_stock"; items: StockShortage[] }

type PreparedHold = { cart_id: string; location_id: string; lines: CartHoldLine[] }

// Kiểm giỏ và dựng dòng giữ hàng. Giỏ đã hoàn tất thì không giữ; giỏ không có món quản kho thì báo lỗi.
const prepareCartHoldStep = createStep(
  "prepare-cart-hold",
  async (input: { cart: any; location_ids: string[] }) => {
    if (input.cart.completed_at) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Cart is already completed", CART_COMPLETED)
    }
    const lines = cartHoldLines((input.cart.items ?? []) as CartItemForHold[])
    if (!lines.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart has no stock-managed items to reserve")
    }
    // Một kho cho cả hệ thống (Kho Q.7): lấy kho đầu tiên của sales channel, như completeCart khi chỉ có một kho.
    const location_id = input.location_ids[0]
    if (!location_id) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The cart's sales channel has no stock location")
    }
    return new StepResponse<PreparedHold>({ cart_id: input.cart.id, location_id, lines })
  }
)

// Món thiếu: so số cần với số còn giữ được cộng phần giỏ này đang giữ (giỏ giữ lại thì phần cũ được tính).
async function shortagesOf(hotStock: HotStockModuleService, hold: PreparedHold): Promise<StockShortage[]> {
  const refs = hold.lines.map((line) => ({ location_id: hold.location_id, inventory_item_id: line.inventory_item_id }))
  const available = await hotStock.available(refs)
  const current = await hotStock.getHold(hold.cart_id)
  const own = new Map((current?.status === "HELD" ? current.lines : []).map((line) => [line.avail_key, line.quantity]))
  return hold.lines
    .map((line, i) => ({
      variant_id: line.variant_ids[0],
      inventory_item_id: line.inventory_item_id,
      requested: line.quantity,
      available: Math.max(0, (available[i] ?? 0) + (own.get(hotStock.keys.avail(refs[i])) ?? 0)),
    }))
    .filter((line) => line.requested > line.available)
}

const reserveCartStockStep = createStep(
  "reserve-cart-stock",
  async (hold: PreparedHold, { container }) => {
    const hotStock = container.resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const lines = hold.lines.map((line) => ({ location_id: hold.location_id, inventory_item_id: line.inventory_item_id, quantity: line.quantity }))
    const reserve = () => hotStock.reserve({ cart_id: hold.cart_id, lines })

    let result: ReserveResult = await reserve()
    if (result.status === "missing_stock_key") {
      await syncItemsFromPostgres(container, hotStock, hold.lines.map((line) => line.inventory_item_id))
      result = await reserve()
    }

    switch (result.status) {
      case "held":
        return new StepResponse<ReserveCartStockResult, string | null>(
          { status: "held", hold: { cart_id: hold.cart_id, status: "HELD", expires_at: new Date(result.expires_at * 1000).toISOString() } },
          hold.cart_id
        )
      case "out_of_stock":
        // Không giữ món nào, nên không có gì để bù trừ.
        return new StepResponse<ReserveCartStockResult, string | null>({ status: "out_of_stock", items: await shortagesOf(hotStock, hold) }, null)
      case "confirmed":
        throw new MedusaError(MedusaError.Types.CONFLICT, "Cart is already completed", CART_COMPLETED)
      default:
        // missing_stock_key sau khi đã đồng bộ = món không có level ở kho; duplicate/invalid = lỗi dựng dòng.
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Cannot reserve stock for cart ${hold.cart_id}: ${result.status}`)
    }
  },
  // Compensation: một bước sau trong workflow lỗi thì trả hàng vừa giữ, khách gọi lại được.
  async (cartId, { container }) => {
    if (cartId) {
      await container.resolve<HotStockModuleService>(HOT_STOCK_MODULE).release(cartId)
    }
  }
)

/**
 * Giữ hàng cho cả giỏ trước khi tạo phiên thanh toán VNPAY (API-14, plan hot-stock HS-4). Giữ 15 phút;
 * gọi lại an toàn (giỏ đổi thì giữ theo giỏ mới). Hết hàng thì trả danh sách món thiếu, không giữ món nào.
 */
export const reserveCartStockWorkflow = createWorkflow("reserve-cart-stock", (input: { cart_id: string }) => {
  const { data: carts } = useQueryGraphStep({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "sales_channel_id",
      "items.variant_id",
      "items.quantity",
      "items.variant.manage_inventory",
      "items.variant.inventory_items.inventory_item_id",
      "items.variant.inventory_items.required_quantity",
    ],
    filters: { id: input.cart_id },
    options: { throwIfKeyNotFound: true },
  }).config({ name: "get-cart-for-hold" })

  const { data: channels } = useQueryGraphStep({
    entity: "sales_channel",
    fields: ["id", "stock_locations.id"],
    filters: transform({ carts }, ({ carts }) => ({ id: carts[0].sales_channel_id as string })),
  }).config({ name: "get-cart-stock-location" })

  const hold = prepareCartHoldStep(
    transform({ carts, channels }, ({ carts, channels }) => ({
      cart: carts[0],
      location_ids: ((channels[0] as any)?.stock_locations ?? []).map((location: { id: string }) => location.id),
    }))
  )
  const result = reserveCartStockStep(hold)
  return new WorkflowResponse(result)
})
