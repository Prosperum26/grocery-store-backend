/** Biến thể như query.graph trả về (các field cần để tính tồn). */
export type VariantForStock = {
  id: string
  manage_inventory?: boolean | null
  inventory_items?: { inventory_item_id: string; required_quantity?: number | string | null }[] | null
}

/**
 * Tồn của một biến thể cho storefront (API-15). `inventory_item_id` là id FE dùng để subscribe Socket.io
 * (API-16); `available` = null khi biến thể không quản kho (không giới hạn). `held_by_cart` = số biến thể
 * mà giỏ của người gọi đang giữ (0 khi không truyền `cart_id`): FE cộng số này vào số chung nhận qua socket.
 */
export type VariantStock = {
  variant_id: string
  inventory_item_id: string | null
  location_id: string | null
  available: number | null
  held_by_cart: number
}

/**
 * Số biến thể còn giữ được cho giỏ này = nhỏ nhất qua các item của nó của
 * floor((còn giữ được của item + phần giỏ này đang giữ) / required_quantity), không âm (Redis có thể âm khi
 * admin giảm tồn dưới phần đang giữ). Catalog hiện mỗi biến thể một item × 1.
 * `availableOf` trả số trong Redis của item (null nếu chưa có key); `heldOf` trả số item giỏ này đang giữ.
 */
export function variantStock(
  variant: VariantForStock,
  locationId: string,
  availableOf: (itemId: string) => number | null,
  heldOf: (itemId: string) => number = () => 0
): VariantStock {
  const links = variant.inventory_items ?? []
  if (variant.manage_inventory === false || !links.length) {
    return { variant_id: variant.id, inventory_item_id: null, location_id: null, available: null, held_by_cart: 0 }
  }
  const units = (count: (itemId: string) => number) =>
    Math.max(0, Math.min(...links.map((link) => Math.floor(count(link.inventory_item_id) / Number(link.required_quantity ?? 1)))))
  return {
    variant_id: variant.id,
    inventory_item_id: links[0].inventory_item_id,
    location_id: locationId,
    available: units((id) => (availableOf(id) ?? 0) + heldOf(id)),
    held_by_cart: units(heldOf),
  }
}
