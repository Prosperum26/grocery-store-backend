import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type { StockRef } from "../modules/hot-stock/lib/keys"
import type HotStockModuleService from "../modules/hot-stock/service"
import { LEVEL_SYNC_FIELDS, levelSyncEntries, type LevelForSync } from "../lib/inventory/stock-levels"

export type SyncHotStockInput = {
  /** Item cần đặt lại; bỏ trống = toàn bộ (dựng lại, đối soát). */
  inventory_item_ids?: string[]
  /** Inventory level vừa bị xoá: món đó không còn tồn ở kho, đặt về 0 (trừ phần đang giữ). */
  removed?: StockRef[]
}

// Đẩy số của Postgres sang Redis. Không cần compensation: Redis chỉ là bản sao, chạy lại lúc nào cũng đúng.
const syncHotStockStep = createStep(
  "sync-hot-stock",
  async (input: { levels: LevelForSync[]; removed: StockRef[] }, { container }) => {
    const hotStock = container.resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const summary = await hotStock.syncItems([
      ...levelSyncEntries(input.levels),
      ...input.removed.map((ref) => ({ ref, postgres_available: 0 })),
    ])
    return new StepResponse(summary)
  }
)

/**
 * Đặt lại `stock:avail` trong Redis từ inventory level của Postgres (plan hot-stock, mục 2.2):
 * avail = stocked − reserved − phần đang giữ. Dùng cho subscriber tồn kho, job đối soát và script dựng lại.
 */
export const syncHotStockWorkflow = createWorkflow("sync-hot-stock", (input: SyncHotStockInput) => {
  const filters = transform({ input }, ({ input }) =>
    input.inventory_item_ids?.length ? { inventory_item_id: input.inventory_item_ids } : {}
  )
  // Có danh sách item mà rỗng (chỉ có removed) thì không cần đọc level nào.
  const skipLevels = transform({ input }, ({ input }) => Array.isArray(input.inventory_item_ids) && !input.inventory_item_ids.length)
  const { data: levels } = useQueryGraphStep({
    entity: "inventory_level",
    fields: LEVEL_SYNC_FIELDS,
    filters,
  })
  const summary = syncHotStockStep(
    transform({ levels, input, skipLevels }, ({ levels, input, skipLevels }) => ({
      levels: skipLevels ? [] : (levels as LevelForSync[]),
      removed: input.removed ?? [],
    }))
  )
  return new WorkflowResponse(summary)
})
