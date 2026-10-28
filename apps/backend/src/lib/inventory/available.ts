// Tồn khả dụng của một biến thể đọc bằng query.graph: tồn trừ hàng đang giữ, cộng mọi kho (hiện chỉ có
// Kho Q.7). Cùng công thức với chỉ mục tìm kiếm (search/helpers/stock.ts) nhưng tính theo biến thể.
// Dùng cho giỏ "Mua lại" (BE-9) và widget Sắp cạn kho (BE-11).

/** Các field cần lấy kèm product_variant khi gọi query.graph. */
export const VARIANT_STOCK_FIELDS = [
  "manage_inventory",
  "inventory_items.required_quantity",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
]

/** Không quản kho thì coi như luôn còn. Biến thể nhiều item lấy item cạn nhất (chia required_quantity). */
export function availableOf(variant: any): number {
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
