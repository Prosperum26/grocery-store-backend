// Đo độ trễ cập nhật tồn kho thời gian thực cho báo cáo (mục 4.3.3).
//
// Một vòng đo: gọi script Lua giữ hàng thật của backend (reserve_hold) → Lua PUBLISH lên kênh Redis →
// gateway (tiến trình riêng, đúng như khi chạy thật) → Socket.io → CLIENTS client đang xem cùng một món.
// Đo từ lúc gửi lệnh Lua tới lúc client đầu tiên và client cuối cùng nhận `stock:update`.
//
// Chạy (cần Redis, ví dụ container com4fud-redis), từ apps/realtime-gateway:
//   node --experimental-strip-types src/bench-latency.ts
// Tuỳ chọn qua biến môi trường: CLIENTS (100), WARMUP (20), ROUNDS (200), BENCH_PORT (4101), REDIS_URL.
// Mọi key dùng tiền tố riêng `c4f-bench-rt:<pid>:` và bị xoá khi kết thúc, không đụng dữ liệu cửa hàng.

import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { cpus, release, totalmem } from "node:os"
import { performance } from "node:perf_hooks"
import { Redis } from "ioredis"
import { io as connect, type Socket } from "socket.io-client"

// Đúng chuỗi Lua mà backend dùng khi khách bấm thanh toán (không chép lại, để đo đúng thứ đang chạy).
// Đọc từ file của backend thay vì import, vì backend là CommonJS còn gateway là ES module.
function loadReserveHoldLua(): string {
  const file = new URL("../../backend/src/modules/hot-stock/lua/reserve-hold.ts", import.meta.url)
  const lua = readFileSync(file, "utf8").match(/RESERVE_HOLD_LUA = `([\s\S]*?)`/)?.[1]
  if (!lua) throw new Error(`RESERVE_HOLD_LUA not found in ${file.pathname}`)
  return lua
}
const RESERVE_HOLD_LUA = loadReserveHoldLua()

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const CLIENTS = Number(process.env.CLIENTS || 100)
const WARMUP = Number(process.env.WARMUP || 20)
const ROUNDS = Number(process.env.ROUNDS || 200)
const PORT = Number(process.env.BENCH_PORT || 4101)
const ROUND_TIMEOUT_MS = 5000

const PREFIX = `c4f-bench-rt:${process.pid}:`
const CHANNEL = `${PREFIX}channel:inventory_events` // gateway tự dựng tên kênh này từ HOT_STOCK_PREFIX
const LOC = "sloc_bench"
const ITEM = "iitem_bench_rt"
const AVAIL = `${PREFIX}stock:avail:${LOC}:${ITEM}`
const HELD = `${PREFIX}stock:held:${LOC}:${ITEM}`
const EXPIRY = `${PREFIX}hold:expiry`

// Phân vị nearest-rank, giống scripts/bench-hot-stock.ts của backend.
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
  return { n: sorted.length, p50: at(50), p95: at(95), p99: at(99), max: sorted[sorted.length - 1] }
}
const fmt = (s: ReturnType<typeof stats>) =>
  `${s.n} | ${s.p50.toFixed(3)} | ${s.p95.toFixed(3)} | ${s.p99.toFixed(3)} | ${s.max.toFixed(3)}`

// Chạy gateway thật bằng src/index.ts trong một tiến trình con, chờ tới khi nó báo đang lắng nghe.
function startGatewayProcess() {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/index.ts"], {
    env: { ...process.env, REDIS_URL, HOT_STOCK_PREFIX: PREFIX, REALTIME_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  })
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) resolve()
    })
    child.on("exit", (code) => reject(new Error(`gateway exited early with code ${code}`)))
  })
  return { child, ready }
}

// Vòng đang đo: thời điểm bắt đầu, số client chưa nhận, và thời gian nhận của từng client.
let pending: { start: number; remaining: number; times: number[]; done: () => void } | null = null

async function connectClient(): Promise<Socket> {
  const socket = connect(`http://localhost:${PORT}`, { transports: ["websocket"] })
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()))
  // Gateway trả ack sau khi đã cho client vào phòng `stock:{item}`.
  const ack = await socket.emitWithAck("subscribe", { inventory_item_ids: [ITEM] })
  if (!ack?.ok) throw new Error(`subscribe failed: ${JSON.stringify(ack)}`)
  socket.on("stock:update", () => {
    if (!pending) return
    pending.times.push(performance.now() - pending.start)
    pending.remaining--
    if (pending.remaining === 0) pending.done()
  })
  return socket
}

async function cleanup(redis: Redis) {
  const keys: string[] = []
  let cursor = "0"
  do {
    const [next, found] = await redis.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 1000)
    cursor = next
    keys.push(...found)
  } while (cursor !== "0")
  if (keys.length) await redis.del(...keys)
}

async function main() {
  const redis = new Redis(REDIS_URL)
  const gateway = startGatewayProcess()
  const sockets: Socket[] = []
  try {
    await gateway.ready
    // Tồn đủ lớn để mọi vòng đều giữ được, nên vòng nào Lua cũng phát tin.
    await redis.set(AVAIL, 1_000_000)
    await redis.set(HELD, 0)
    for (let i = 0; i < CLIENTS; i++) sockets.push(await connectClient())

    const firstClient: number[] = []
    const lastClient: number[] = []
    for (let round = 0; round < WARMUP + ROUNDS; round++) {
      const received = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`round ${round}: only ${CLIENTS - pending!.remaining}/${CLIENTS} clients got the update`)), ROUND_TIMEOUT_MS)
        pending = { start: 0, remaining: CLIENTS, times: [], done: () => { clearTimeout(timer); resolve() } }
      })
      // Mỗi vòng một giỏ mới, giữ 1 món: KEYS = hold, hold:expiry, avail, held; ARGV = cart, now, ttl, kênh, số lượng.
      const cartId = `rt-${round}`
      pending!.start = performance.now()
      const [code] = (await redis.eval(
        RESERVE_HOLD_LUA, 4, `${PREFIX}hold:${cartId}`, EXPIRY, AVAIL, HELD,
        cartId, Math.floor(Date.now() / 1000), 900, CHANNEL, 1
      )) as [number, number]
      if (code !== 1) throw new Error(`round ${round}: reserve_hold returned ${code}`)
      await received
      if (round >= WARMUP) {
        firstClient.push(Math.min(...pending!.times))
        lastClient.push(Math.max(...pending!.times))
      }
      pending = null
    }

    const cpu = cpus()
    console.log("=== realtime stock latency benchmark ===")
    console.log(`Machine: ${cpu[0]?.model.trim()}, ${cpu.length} logical CPUs, ${Math.round(totalmem() / 2 ** 30)} GB RAM, ${process.platform} ${release()}`)
    console.log(`Redis: ${(await redis.info("server")).match(/redis_version:(\S+)/)?.[1]} at ${REDIS_URL}; Node ${process.version}; date ${new Date().toISOString()}`)
    console.log(`Path: Lua reserve_hold -> Redis Pub/Sub -> gateway (separate process) -> Socket.io -> ${CLIENTS} clients on the same item, same machine`)
    console.log(`Rounds: ${ROUNDS} measured after ${WARMUP} warm-up rounds`)
    console.log("Latency (ms): measure | n | p50 | p95 | p99 | max")
    console.log(`first client | ${fmt(stats(firstClient))}`)
    console.log(`last client (all ${CLIENTS} received) | ${fmt(stats(lastClient))}`)
  } finally {
    sockets.forEach((socket) => socket.close())
    gateway.child.kill()
    await cleanup(redis)
    await redis.quit()
  }
}

await main()
