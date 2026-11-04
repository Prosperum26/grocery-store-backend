import { startGateway } from "./gateway.ts"

// Cùng biến với backend (apps/backend/.env): REDIS_URL, HOT_STOCK_PREFIX, STORE_CORS. Thêm REALTIME_PORT.
const prefix = process.env.HOT_STOCK_PREFIX || "c4f:"
const gateway = await startGateway({
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  channel: `${prefix}channel:inventory_events`,
  port: Number(process.env.REALTIME_PORT || 4001),
  corsOrigins: (process.env.STORE_CORS || "http://localhost:8000").split(",").map((origin) => origin.trim()),
})
console.log(`realtime-gateway: listening on :${gateway.port}, Redis channel ${prefix}channel:inventory_events`)

const shutdown = async () => {
  await gateway.close()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
