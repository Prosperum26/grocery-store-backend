/** Một món tồn kho trong Redis: inventory item tại một kho (plan D6). */
export type StockRef = { location_id: string; inventory_item_id: string }

/**
 * Tên key Redis của module (plan mục 2.1). Mọi key bắt đầu bằng `prefix` ("c4f:", test dùng "c4f-test:").
 * - `stock:avail:{loc}:{item}`: số còn giữ được = stocked − reserved (Medusa) − held
 * - `stock:held:{loc}:{item}`: tổng số lượng các hold đang HELD của món
 * - `hold:{cart_id}`: hash một hold, field = key avail của từng món, value = số lượng; cộng `__status`, `__exp`, `__attempt`
 * - `hold:expiry`: sorted set cart_id → hạn (giây)
 */
export function hotStockKeys(prefix: string) {
  const availPrefix = `${prefix}stock:avail:`
  const heldPrefix = `${prefix}stock:held:`
  return {
    avail: (ref: StockRef) => `${availPrefix}${ref.location_id}:${ref.inventory_item_id}`,
    held: (ref: StockRef) => `${heldPrefix}${ref.location_id}:${ref.inventory_item_id}`,
    hold: (cartId: string) => `${prefix}hold:${cartId}`,
    expiry: () => `${prefix}hold:expiry`,
    /** Hash của hold lưu key avail; key held của cùng món suy ra bằng cách đổi đoạn đầu. */
    heldFromAvail: (availKey: string) => {
      if (!availKey.startsWith(availPrefix)) {
        throw new Error(`hot-stock: not a stock key: ${availKey}`)
      }
      return heldPrefix + availKey.slice(availPrefix.length)
    },
  }
}

export type HotStockKeys = ReturnType<typeof hotStockKeys>
