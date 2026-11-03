import type { RemoteQueryFunction } from "@medusajs/framework/types"
import type { StockRef } from "../../modules/hot-stock/lib/keys"

/** Món cần đặt lại trong Redis sau một event tồn kho. */
export type StockEventTarget = { inventory_item_ids: string[]; removed: StockRef[] }

/**
 * Event `inventory-level.*` và `reservation-item.*` chỉ mang `id` (verified-apis HS-0). Tra ra inventory item;
 * bản ghi vừa xoá vẫn đọc được bằng `withDeleted`. Không tìm thấy thì trả null (người gọi đặt lại toàn bộ).
 */
export async function stockEventTarget(
  query: Pick<RemoteQueryFunction, "graph">,
  eventName: string,
  id: string
): Promise<StockEventTarget | null> {
  if (eventName.startsWith("inventory-level.")) {
    const { data } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "location_id", "deleted_at"],
      filters: { id },
      withDeleted: true,
    } as any)
    const level = data[0] as { inventory_item_id: string; location_id: string; deleted_at: string | null } | undefined
    if (!level) {
      return null
    }
    return level.deleted_at
      ? { inventory_item_ids: [], removed: [{ location_id: level.location_id, inventory_item_id: level.inventory_item_id }] }
      : { inventory_item_ids: [level.inventory_item_id], removed: [] }
  }
  const { data } = await query.graph({
    entity: "reservation_item",
    fields: ["id", "inventory_item_id"],
    filters: { id },
    withDeleted: true,
  } as any)
  const reservation = data[0] as { inventory_item_id: string } | undefined
  return reservation ? { inventory_item_ids: [reservation.inventory_item_id], removed: [] } : null
}
