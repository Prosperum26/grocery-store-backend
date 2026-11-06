import { asValue } from "@medusajs/framework/awilix"
import type { LoaderOptions } from "@medusajs/framework/types"
import Redis from "ioredis"
import { REDIS_CLIENT, type HotStockOptions } from "../types"

/**
 * Mở **một** kết nối Redis cho cả module và ping thử. Loader ném lỗi thì Medusa dừng khởi động
 * (plan D8: thiếu Redis phải báo ngay). Không dùng __hooks.onApplicationStart vì Medusa nuốt lỗi của hook đó.
 */
export default async function redisLoader({ container, options }: LoaderOptions<HotStockOptions>) {
  if (!options?.redisUrl) {
    throw new Error("hot-stock: missing redisUrl option (set REDIS_URL in apps/backend/.env)")
  }
  const client = new Redis(options.redisUrl, {
    lazyConnect: true,
    // Lúc đang mất kết nối thì lệnh lỗi ngay, không xếp hàng chờ: giữ hàng phải trả lời nhanh hoặc báo lỗi.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  })
  try {
    await client.connect()
    await client.ping()
  } catch (e) {
    client.disconnect()
    throw new Error(`hot-stock: cannot reach Redis at ${options.redisUrl} (${(e as Error).message}). Start it with: docker start com4fud-redis`)
  }
  container.register({ [REDIS_CLIENT]: asValue(client) })
}
