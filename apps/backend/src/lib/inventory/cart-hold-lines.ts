/** Dòng giỏ như query.graph trả về (các field cần cho việc giữ hàng). */
export type CartItemForHold = {
  variant_id?: string | null
  quantity: number | string
  variant?: {
    manage_inventory?: boolean | null
    inventory_items?: { inventory_item_id: string; required_quantity?: number | string | null }[] | null
  } | null
}

/** Một món cần giữ: tổng số lượng của mọi dòng giỏ dùng inventory item đó. */
export type CartHoldLine = { inventory_item_id: string; quantity: number; variant_ids: string[] }

/**
 * Đổi dòng giỏ thành dòng giữ hàng theo inventory item (plan hot-stock D6):
 * - bỏ biến thể không quản kho (`manage_inventory = false`), như Medusa khi hoàn tất giỏ
 * - số lượng = số lượng dòng × `required_quantity` của item (biến thể dạng combo dùng nhiều item)
 * - gộp các dòng cùng item (hai dòng cùng biến thể khác cách sơ chế, hoặc hai biến thể chung item);
 *   script giữ hàng từ chối dòng trùng nên phải gộp trước
 */
export function cartHoldLines(items: CartItemForHold[]): CartHoldLine[] {
  const byItem = new Map<string, CartHoldLine>()
  for (const item of items) {
    const variant = item.variant
    if (!variant || variant.manage_inventory === false) {
      continue
    }
    for (const link of variant.inventory_items ?? []) {
      const quantity = Number(item.quantity) * Number(link.required_quantity ?? 1)
      const line = byItem.get(link.inventory_item_id) ?? { inventory_item_id: link.inventory_item_id, quantity: 0, variant_ids: [] }
      line.quantity += quantity
      if (item.variant_id && !line.variant_ids.includes(item.variant_id)) {
        line.variant_ids.push(item.variant_id)
      }
      byItem.set(link.inventory_item_id, line)
    }
  }
  return [...byItem.values()].filter((line) => line.quantity > 0)
}
