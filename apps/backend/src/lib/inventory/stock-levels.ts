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
