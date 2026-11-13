import Redis from "ioredis"
import type { CacheRedis } from "./cache"

/**
 * Một kết nối Redis dùng chung cho cache "Mua lại", mở ở lần dùng đầu. Cùng REDIS_URL và tiền tố khoá với module
 * hot-stock (test dùng `c4f-test:` để không đụng khoá của DB dev). Lệnh lỗi ngay khi mất kết nối thay vì xếp hàng,
 * để cache hỏng thì "Mua lại" vẫn trả lời nhanh bằng cách gọi model.
 */
let client: Redis | null = null

export function reorderCacheRedis(): CacheRedis | null {
  if (process.env.REORDER_CACHE === "off") {
    return null
  }
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    })
    // Không có handler thì ioredis ghi "Unhandled error event" mỗi lần thử lại; lỗi thật đã được cache.ts báo.
    client.on("error", () => undefined)
  }
  return client as unknown as CacheRedis
}

export const reorderCachePrefix = () => process.env.HOT_STOCK_PREFIX || (process.env.NODE_ENV === "test" ? "c4f-test:" : "c4f:")
