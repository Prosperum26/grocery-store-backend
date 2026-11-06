// Hàm thuần của gateway: đọc tin nhắn từ Redis, kiểm dữ liệu khách gửi lên, đặt tên phòng.

/** Tin nhắn Lua phát lên kênh mỗi khi số còn giữ được của một món đổi (backend, hot-stock HS-8). */
export type StockUpdate = { location_id: string; inventory_item_id: string; available: number }

/** Mỗi lần subscribe tối đa chừng này món (một trang sản phẩm, một giỏ). */
export const MAX_ITEMS = 100

// Id của Medusa: chữ, số, gạch dưới (iitem_01...). Chặn chuỗi lạ làm tên phòng.
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** Phòng Socket.io của một inventory item: mọi khách đang xem món đó. */
export const roomOf = (inventoryItemId: string) => `stock:${inventoryItemId}`

/** Tin nhắn từ Redis → StockUpdate, hoặc null nếu sai dạng (bỏ qua, không làm sập gateway). */
export function parseStockMessage(raw: string): StockUpdate | null {
  try {
    const value = JSON.parse(raw)
    if (typeof value?.inventory_item_id !== "string" || !ID.test(value.inventory_item_id)) return null
    if (typeof value.location_id !== "string" || typeof value.available !== "number" || !Number.isFinite(value.available)) return null
    // Redis có thể âm khi admin giảm tồn dưới phần đang giữ; khách chỉ cần biết là hết.
    return { location_id: value.location_id, inventory_item_id: value.inventory_item_id, available: Math.max(0, value.available) }
  } catch {
    return null
  }
}

/**
 * Dữ liệu `subscribe` / `unsubscribe` của khách: `{ inventory_item_ids: string[] }` (lấy từ API-15).
 * Trả danh sách id đã bỏ trùng, hoặc chuỗi lỗi.
 */
export function parseSubscription(payload: unknown): string[] | string {
  const ids = (payload as { inventory_item_ids?: unknown } | null)?.inventory_item_ids
  if (!Array.isArray(ids) || !ids.length) return "inventory_item_ids must be a non-empty array"
  if (ids.length > MAX_ITEMS) return `at most ${MAX_ITEMS} inventory_item_ids`
  if (!ids.every((id) => typeof id === "string" && ID.test(id))) return "invalid inventory_item_id"
  return [...new Set(ids as string[])]
}
