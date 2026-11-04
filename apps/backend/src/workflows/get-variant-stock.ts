import { MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { syncItemsFromPostgres } from "../lib/inventory/stock-levels"
import { variantStock, type VariantForStock, type VariantStock } from "../lib/inventory/variant-stock"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"

// Đọc số còn giữ được trong Redis (đã trừ phần khách khác đang giữ). Món chưa có key thì đặt lại từ Postgres.
const readVariantStockStep = createStep(
  "read-variant-stock",
  async (input: { variants: VariantForStock[]; location_ids: string[] }, { container }) => {
    const location_id = input.location_ids[0]
    if (!location_id) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The sales channel has no stock location")
    }
    const hotStock = container.resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const itemIds = [...new Set(input.variants.flatMap((v) => (v.inventory_items ?? []).map((link) => link.inventory_item_id)))]
    const read = async () => {
      const values = await hotStock.available(itemIds.map((inventory_item_id) => ({ location_id, inventory_item_id })))
      return new Map(itemIds.map((id, i) => [id, values[i]]))
    }
    let available = await read()
    const missing = itemIds.filter((id) => available.get(id) === null)
    if (missing.length) {
      await syncItemsFromPostgres(container, hotStock, missing)
      available = await read()
    }
    return new StepResponse<VariantStock[]>(input.variants.map((v) => variantStock(v, location_id, (id) => available.get(id) ?? null)))
  }
)

/**
 * Tồn của các biến thể cho storefront (API-15, plan hot-stock HS-8): giá trị ban đầu cho badge và khi Socket.io
 * kết nối lại. Khác `inventory_quantity` của Store API ở chỗ đã trừ phần đang được giữ (rủi ro R6).
 * Biến thể lạ hoặc không thuộc sales channel của publishable key thì bỏ qua.
 */
export const getVariantStockWorkflow = createWorkflow(
  "get-variant-stock",
  (input: { variant_ids: string[]; sales_channel_ids: string[] }) => {
    const { data: variants } = useQueryGraphStep({
      entity: "product_variant",
      fields: ["id", "manage_inventory", "inventory_items.inventory_item_id", "inventory_items.required_quantity", "product.sales_channels.id"],
      filters: { id: input.variant_ids },
    }).config({ name: "get-variants-for-stock" })

    const { data: channels } = useQueryGraphStep({
      entity: "sales_channel",
      fields: ["id", "stock_locations.id"],
      filters: { id: input.sales_channel_ids },
    }).config({ name: "get-channel-stock-location" })

    const stock = readVariantStockStep(
      transform({ variants, channels, input }, ({ variants, channels, input }) => ({
        variants: (variants as any[]).filter((v) =>
          (v.product?.sales_channels ?? []).some((channel: { id: string }) => input.sales_channel_ids.includes(channel.id))
        ) as VariantForStock[],
        location_ids: (channels as any[]).flatMap((channel) => (channel.stock_locations ?? []).map((location: { id: string }) => location.id)),
      }))
    )
    return new WorkflowResponse(stock)
  }
)
