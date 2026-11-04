import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type HotStockModuleService from "../../modules/hot-stock/service"
import type { SyncEntry } from "../../modules/hot-stock/service"

/** Inventory level như query.graph trả về (số lượng có thể là chuỗi hoặc BigNumber). */
export type LevelForSync = { inventory_item_id: string; location_id: string; stocked_quantity: unknown; reserved_quantity: unknown }

export const LEVEL_SYNC_FIELDS = ["inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity"]

/** Level của Postgres → món cần đặt lại trong Redis: `postgres_available` = stocked − reserved. */
export function levelSyncEntries(levels: LevelForSync[]): SyncEntry[] {
  return levels.map((level) => ({
    ref: { location_id: level.location_id, inventory_item_id: level.inventory_item_id },
    postgres_available: Number(level.stocked_quantity) - Number(level.reserved_quantity),
  }))
}

/**
 * Redis chưa có key của món (khởi động lạnh, Redis vừa bị xoá): đọc level của các món từ Postgres rồi đặt lại.
 * Dùng trong bước workflow cần số ngay (giữ hàng HS-4, đọc tồn API-15), không chờ subscriber hay job đối soát.
 */
export async function syncItemsFromPostgres(container: MedusaContainer, hotStock: HotStockModuleService, itemIds: string[]) {
  if (!itemIds.length) {
    return
  }
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "inventory_level",
    fields: LEVEL_SYNC_FIELDS,
    filters: { inventory_item_id: itemIds },
  })
  await hotStock.syncItems(levelSyncEntries(data as LevelForSync[]))
}
