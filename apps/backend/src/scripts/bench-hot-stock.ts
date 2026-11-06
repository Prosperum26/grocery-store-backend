import type { ExecArgs } from "@medusajs/framework/types"
import Redis from "ioredis"
import { cpus, platform, release, totalmem } from "os"
import { performance } from "perf_hooks"
import HotStockModuleService, { type HoldLine } from "../modules/hot-stock/service"
import { REDIS_CLIENT } from "../modules/hot-stock/types"

// Đo cổng giữ hàng ở mức Redis cho báo cáo (plan hot-stock HS-7). Không đụng dữ liệu của cửa hàng: dùng tiền tố
// riêng "c4f-bench:" và xoá hết khi xong. Chạy: cd apps/backend && npx medusa exec ./src/scripts/bench-hot-stock.ts
// Số in ra là số đo trên máy chạy script, không phải mục tiêu của proposal.

const PREFIX = "c4f-bench:"
const LOC = "sloc_bench"
const ITERATIONS = 5000 // số lần đo độ trễ mỗi loại
const CLIENTS = 20 // số kết nối khi chạy đồng thời
const N = 100 // H4: số yêu cầu cùng lúc
const S0 = 5 // H4: tồn ban đầu
const ROUNDS = 20

const ref = (item: string) => ({ location_id: LOC, inventory_item_id: item })
const line = (item: string, quantity = 1): HoldLine => ({ ...ref(item), quantity })

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
  return { n: sorted.length, p50: at(50), p95: at(95), p99: at(99), max: sorted[sorted.length - 1] }
}
const fmt = (s: ReturnType<typeof stats>) => `${s.n} | ${s.p50.toFixed(3)} | ${s.p95.toFixed(3)} | ${s.p99.toFixed(3)} | ${s.max.toFixed(3)}`

async function cleanup(r: Redis) {
  let cursor = "0"
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 1000)
    if (keys.length) await r.del(...keys)
    cursor = next
  } while (cursor !== "0")
}

// Cách làm sai để so sánh: đọc rồi trừ bằng hai lệnh riêng. Giữa GET và DECRBY, yêu cầu khác chen vào được.
async function naiveReserve(r: Redis, key: string): Promise<boolean> {
  const have = Number(await r.get(key))
  if (have < 1) return false
  await r.decrby(key, 1)
  return true
}

export default async function benchHotStock(_: ExecArgs) {
  const url = process.env.REDIS_URL || "redis://localhost:6379"
  const clients = Array.from({ length: CLIENTS }, () => new Redis(url))
  const services = clients.map((client) => new HotStockModuleService({ [REDIS_CLIENT]: client }, { redisUrl: url, prefix: PREFIX }))
  const [r] = clients
  const [svc] = services
  await cleanup(r)

  const out: string[] = []
  const cpu = cpus()
  out.push(`Machine: ${cpu[0].model}, ${cpu.length} logical CPUs, ${Math.round(totalmem() / 2 ** 30)} GB RAM, ${platform()} ${release()}`)
  out.push(`Redis: ${(await r.info("server")).match(/redis_version:(\S+)/)?.[1]} at ${url}; Node ${process.version}; date ${new Date().toISOString()}`)
  out.push("")

  // 1. Độ trễ một lệnh (một kết nối, gọi lần lượt), đo từ phía client: gồm cả đường mạng tới Redis.
  for (const item of ["A", "B", "C"]) await svc.syncItem(ref(item), 1_000_000)
  const latency: Record<string, number[]> = { reserve_1_line: [], reserve_3_lines: [], release: [], sync_item: [] }
  for (let i = 0; i < ITERATIONS; i++) {
    let t = performance.now()
    await svc.reserve({ cart_id: `lat1-${i}`, lines: [line("A")] })
    latency.reserve_1_line.push(performance.now() - t)

    t = performance.now()
    await svc.reserve({ cart_id: `lat3-${i}`, lines: [line("A"), line("B", 2), line("C", 3)] })
    latency.reserve_3_lines.push(performance.now() - t)

    t = performance.now()
    await svc.release(`lat3-${i}`)
    latency.release.push(performance.now() - t)

    t = performance.now()
    await svc.syncItem(ref("C"), 1_000_000)
    latency.sync_item.push(performance.now() - t)
  }
  out.push("Latency, one connection, sequential (ms): operation | n | p50 | p95 | p99 | max")
  for (const [name, values] of Object.entries(latency)) out.push(`${name} | ${fmt(stats(values))}`)
  out.push("")

  // 2. H4 ở mức Redis: N yêu cầu cùng lúc qua CLIENTS kết nối tranh S0 món, lặp ROUNDS lần.
  const luaRows: { held: number; avail: number }[] = []
  const concurrent: number[] = []
  for (let round = 1; round <= ROUNDS; round++) {
    await cleanup(r)
    await svc.syncItem(ref("H"), S0)
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const t = performance.now()
        const res = await services[i % CLIENTS].reserve({ cart_id: `h4-${round}-${i}`, lines: [line("H")] })
        concurrent.push(performance.now() - t)
        return res
      })
    )
    luaRows.push({ held: results.filter((x) => x.status === "held").length, avail: (await svc.available([ref("H")]))[0]! })
  }

  // 3. Cùng thí nghiệm với cách làm sai (GET rồi DECRBY).
  const naiveRows: { sold: number; stock: number }[] = []
  const naiveKey = `${PREFIX}naive:H`
  for (let round = 1; round <= ROUNDS; round++) {
    await r.set(naiveKey, S0)
    const results = await Promise.all(Array.from({ length: N }, (_, i) => naiveReserve(clients[i % CLIENTS], naiveKey)))
    naiveRows.push({ sold: results.filter(Boolean).length, stock: Number(await r.get(naiveKey)) })
  }

  const sum = (rows: number[]) => rows.reduce((a, b) => a + b, 0)
  out.push(`H4 at Redis level: N=${N} concurrent requests over ${CLIENTS} connections, S0=${S0}, ${ROUNDS} rounds`)
  out.push("method | rounds exactly S0 | sold per round (min-max) | oversold units (total) | lowest stock")
  out.push(
    `Lua reserve_hold | ${luaRows.filter((x) => x.held === S0).length}/${ROUNDS} | ${Math.min(...luaRows.map((x) => x.held))}-${Math.max(...luaRows.map((x) => x.held))} | ` +
      `${sum(luaRows.map((x) => Math.max(0, x.held - S0)))} | ${Math.min(...luaRows.map((x) => x.avail))}`
  )
  out.push(
    `GET + DECRBY | ${naiveRows.filter((x) => x.sold === S0).length}/${ROUNDS} | ${Math.min(...naiveRows.map((x) => x.sold))}-${Math.max(...naiveRows.map((x) => x.sold))} | ` +
      `${sum(naiveRows.map((x) => Math.max(0, x.sold - S0)))} | ${Math.min(...naiveRows.map((x) => x.stock))}`
  )
  out.push(`Lua reserve under contention (ms, ${concurrent.length} requests): n | p50 | p95 | p99 | max = ${fmt(stats(concurrent))}`)

  await cleanup(r)
  await Promise.all(clients.map((client) => client.quit()))
  console.log(["", "=== hot-stock benchmark ===", ...out].join("\n"))
}
