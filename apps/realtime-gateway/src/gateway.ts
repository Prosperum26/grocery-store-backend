import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Redis } from "ioredis"
import { Server } from "socket.io"
import { parseStockMessage, parseSubscription, roomOf } from "./rooms.ts"

export type GatewayOptions = {
  redisUrl: string
  /** Kênh Pub/Sub của backend: `${HOT_STOCK_PREFIX}channel:inventory_events`. */
  channel: string
  /** 0 = cổng ngẫu nhiên (test). */
  port: number
  /** Origin của storefront được phép kết nối (STORE_CORS của backend). */
  corsOrigins: string[]
}

/**
 * Gateway real-time (API-16, plan hot-stock HS-8):
 * 1. Subscribe kênh Redis mà script Lua giữ/trả/đặt lại tồn phát lên.
 * 2. Khách gửi `subscribe { inventory_item_ids }` thì vào phòng `stock:{item}` của từng món.
 * 3. Có tin nhắn thì đẩy `stock:update { location_id, inventory_item_id, available }` tới phòng của món đó.
 * Gateway chỉ đọc và chuyển tiếp: không ghi Redis, không cần Postgres. Pub/Sub không lưu tin cũ, nên khách
 * kết nối lại phải gọi lại API-15 để lấy số hiện tại.
 */
export async function startGateway(options: GatewayOptions) {
  const http = createServer()
  const io = new Server(http, { cors: { origin: options.corsOrigins } })

  io.on("connection", (socket) => {
    socket.on("subscribe", async (payload: unknown, ack?: (reply: unknown) => void) => {
      const ids = parseSubscription(payload)
      if (typeof ids === "string") {
        ack?.({ ok: false, error: ids })
        return
      }
      await socket.join(ids.map(roomOf))
      ack?.({ ok: true, inventory_item_ids: ids })
    })
    socket.on("unsubscribe", async (payload: unknown, ack?: (reply: unknown) => void) => {
      const ids = parseSubscription(payload)
      if (typeof ids === "string") {
        ack?.({ ok: false, error: ids })
        return
      }
      for (const id of ids) await socket.leave(roomOf(id))
      ack?.({ ok: true, inventory_item_ids: ids })
    })
  })

  // Kết nối Redis riêng cho subscribe (kết nối đang subscribe không chạy được lệnh khác).
  const subscriber = new Redis(options.redisUrl)
  subscriber.on("message", (_channel, raw) => {
    const update = parseStockMessage(raw)
    if (update) {
      io.to(roomOf(update.inventory_item_id)).emit("stock:update", update)
    }
  })
  await subscriber.subscribe(options.channel)

  await new Promise<void>((resolve) => http.listen(options.port, resolve))
  const port = (http.address() as AddressInfo).port

  return {
    port,
    io,
    async close() {
      await subscriber.quit()
      await new Promise<void>((resolve) => io.close(() => resolve()))
    },
  }
}
