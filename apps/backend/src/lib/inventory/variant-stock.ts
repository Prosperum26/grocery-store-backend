/** Biến thể như query.graph trả về (các field cần để tính tồn). */
export type VariantForStock = {
  id: string
  manage_inventory?: boolean | null
  inventory_items?: { inventory_item_id: string; required_quantity?: number | string | null }[] | null
}

/**
 * Tồn của một biến thể cho storefront (API-15). `inventory_item_id` là id FE dùng để subscribe Socket.io
 * (API-16); `available` = null khi biến thể không quản kho (không giới hạn).
 */
export type VariantStock = { variant_id: string; inventory_item_id: string | null; location_id: string | null; available: number | null }

/**
 * Số biến thể còn giữ được = nhỏ nhất qua các item của nó của floor(còn giữ được của item / required_quantity),
 * không âm (Redis có thể âm khi admin giảm tồn dưới phần đang giữ). Catalog hiện mỗi biến thể một item × 1.
 * `availableOf` trả số trong Redis của item, hoặc null nếu chưa có key.
 */
export function variantStock(variant: VariantForStock, locationId: string, availableOf: (itemId: string) => number | null): VariantStock {
  const links = variant.inventory_items ?? []
  if (variant.manage_inventory === false || !links.length) {
    return { variant_id: variant.id, inventory_item_id: null, location_id: null, available: null }
  }
  const perItem = links.map((link) => Math.floor((availableOf(link.inventory_item_id) ?? 0) / Number(link.required_quantity ?? 1)))
  return {
    variant_id: variant.id,
    inventory_item_id: links[0].inventory_item_id,
    location_id: locationId,
    available: Math.max(0, Math.min(...perItem)),
  }
}
