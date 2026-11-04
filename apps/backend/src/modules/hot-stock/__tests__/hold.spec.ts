import Redis from "ioredis"
import HotStockModuleService, { type HoldLine } from "../service"
import { REDIS_CLIENT } from "../types"

// Test module trên Redis thật (container com4fud-redis), không cần Medusa. Chuyển từ bước 1–3 của
// issue #9 (vitest) và thêm các ca của plan HS-2. Mỗi lần chạy dùng tiền tố riêng rồi xoá sạch.
jest.setTimeout(120 * 1000)

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const PREFIX = `c4f-test:hs2:${process.pid}:`
const LOC = "sloc_test"
const ref = (item: string) => ({ location_id: LOC, inventory_item_id: item })
const line = (item: string, quantity: number): HoldLine => ({ ...ref(item), quantity })

// 20 kết nối riêng như repo thử, để các lệnh đồng thời thật sự đi song song tới Redis.
const clients = Array.from({ length: 20 }, () => new Redis(REDIS_URL))
const services = clients.map((client) => new HotStockModuleService({ [REDIS_CLIENT]: client }, { redisUrl: REDIS_URL, prefix: PREFIX }))
const svc = services[0]
const r = clients[0]

async function cleanup() {
  let cursor = "0"
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 500)
    if (keys.length) {
      await r.del(...keys)
    }
    cursor = next
  } while (cursor !== "0")
}

// Tồn Postgres (stocked − reserved) của từng món; đặt vào Redis bằng syncItem như HS-3 sẽ làm.
const postgres: Record<string, number> = {}
async function seed(stock: Record<string, number>) {
  await cleanup()
  for (const [item, qty] of Object.entries(stock)) {
    postgres[item] = qty
    await svc.syncItem(ref(item), qty)
  }
}
const avail = async (...items: string[]) => svc.available(items.map(ref))
const held = async (...items: string[]) =>
  (await r.mget(...items.map((item) => svc.keys.held(ref(item))))).map((v) => (v === null ? null : Number(v)))
const status = async (cartId: string) => (await svc.getHold(cartId))?.status ?? null

// Bất biến: avail + held = tồn Postgres, và held = tổng số lượng các hold đang HELD của món.
async function expectInvariant(items: string[], confirmed: Record<string, number> = {}) {
  const heldByHolds: Record<string, number> = {}
  let cursor = "0"
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `${PREFIX}hold:*`, "COUNT", 500)
    for (const key of keys.filter((k) => !k.endsWith("hold:expiry"))) {
      const hold = await r.hgetall(key)
      if (hold.__status !== "HELD") continue
      for (const [field, qty] of Object.entries(hold)) {
        if (!field.startsWith("__")) heldByHolds[field] = (heldByHolds[field] ?? 0) + Number(qty)
      }
    }
    cursor = next
  } while (cursor !== "0")
  for (const item of items) {
    const [a] = await avail(item)
    const [h] = await held(item)
    // Hold CONFIRMED đã thành reservation của Medusa: tồn Postgres giảm đúng phần đó.
    expect({ item, sum: a! + h! }).toEqual({ item, sum: postgres[item] - (confirmed[item] ?? 0) })
    expect({ item, held: h }).toEqual({ item, held: heldByHolds[svc.keys.avail(ref(item))] ?? 0 })
    expect(a).toBeGreaterThanOrEqual(0)
  }
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await Promise.all(clients.map((client) => client.quit()))
})

describe("reserve: giữ cả giỏ, tất cả hoặc không món nào", () => {
  it("giữ được: trừ avail, tăng held, hold HELD có hạn trong lịch hết hạn", async () => {
    await seed({ A: 5, B: 5, C: 5 })
    const res = await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 1)], now: 1000, ttl: 900 })
    expect(res).toEqual({ status: "held", expires_at: 1900 })
    expect(await avail("A", "B", "C")).toEqual([3, 4, 5])
    expect(await held("A", "B", "C")).toEqual([2, 1, 0])
    expect(await status("c1")).toBe("HELD")
    expect(await r.zscore(svc.keys.expiry(), "c1")).toBe("1900")
  })

  it("thiếu ở bất kỳ dòng nào: báo đúng dòng, không đổi gì, không tạo hold", async () => {
    await seed({ A: 1, B: 9, C: 9 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 1)] })).toEqual({ status: "out_of_stock", line: 0 })
    await seed({ A: 9, B: 1, C: 9 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 1), line("B", 2), line("C", 1)] })).toEqual({ status: "out_of_stock", line: 1 })
    expect(await avail("A", "B", "C")).toEqual([9, 1, 9])
    expect(await held("A", "B", "C")).toEqual([0, 0, 0])
    expect(await status("c1")).toBeNull()
    expect(await r.zcard(svc.keys.expiry())).toBe(0)
  })

  it("mua đúng bằng tồn thì được, tồn về 0 chứ không âm", async () => {
    await seed({ A: 2 })
    expect((await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })).status).toBe("held")
    expect(await svc.reserve({ cart_id: "c2", lines: [line("A", 1)] })).toEqual({ status: "out_of_stock", line: 0 })
    expect(await avail("A")).toEqual([0])
  })

  it("key tồn chưa đồng bộ: missing_stock_key, không tạo key, không đổi dòng khác", async () => {
    await seed({ A: 5 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 1), line("X", 1)] })).toEqual({ status: "missing_stock_key", line: 1 })
    expect(await avail("A", "X")).toEqual([5, null])
    expect(await status("c1")).toBeNull()
  })

  it("dòng trùng món và số lượng sai đều bị từ chối, không đổi gì", async () => {
    await seed({ A: 5, B: 5 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 1), line("B", 1), line("A", 1)] })).toEqual({ status: "duplicate_line", line: 2 })
    for (const bad of [0, -1, 1.5]) {
      expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 1), line("B", bad)] })).toEqual({ status: "invalid", line: 1 })
    }
    expect(await svc.reserve({ cart_id: "c1", lines: [] })).toEqual({ status: "invalid" })
    expect(await avail("A", "B")).toEqual([5, 5])
  })

  it("100 giỏ tranh 5 món, lặp 20 lần: đúng 5 giỏ giữ được, avail 0, held 5", async () => {
    for (let round = 1; round <= 20; round++) {
      await seed({ A: 5 })
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => services[i % services.length].reserve({ cart_id: `r${round}-${i}`, lines: [line("A", 1)] }))
      )
      expect({ round, held: results.filter((x) => x.status === "held").length }).toEqual({ round, held: 5 })
      expect({ round, out: results.filter((x) => x.status === "out_of_stock").length }).toEqual({ round, out: 95 })
      expect({ round, stock: await avail("A"), held: await held("A") }).toEqual({ round, stock: [0], held: [5] })
    }
  })

  it("100 giỏ ba món (A,B,C) tranh tồn 5,5,5, lặp 20 lần: đúng 5 giỏ, cả ba về 0", async () => {
    for (let round = 1; round <= 20; round++) {
      await seed({ A: 5, B: 5, C: 5 })
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          services[i % services.length].reserve({ cart_id: `m${round}-${i}`, lines: [line("A", 1), line("B", 1), line("C", 1)] })
        )
      )
      expect({ round, held: results.filter((x) => x.status === "held").length }).toEqual({ round, held: 5 })
      expect({ round, stock: await avail("A", "B", "C") }).toEqual({ round, stock: [0, 0, 0] })
    }
  })

  it("giỏ chéo nhau (A+B và B+C) tranh B: không bao giờ vượt tồn", async () => {
    for (let round = 1; round <= 20; round++) {
      await seed({ A: 10, B: 5, C: 10 })
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          services[i % services.length].reserve({
            cart_id: `x${round}-${i}`,
            lines: i % 2 ? [line("A", 1), line("B", 1)] : [line("B", 1), line("C", 1)],
          })
        )
      )
      expect({ round, held: results.filter((x) => x.status === "held").length }).toEqual({ round, held: 5 })
      await expectInvariant(["A", "B", "C"])
    }
  })
})

describe("reserve gọi lại cùng giỏ (plan D5)", () => {
  it("gọi lại y hệt: không trừ lần hai, hạn được tính lại", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 1000 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 1300 })).toEqual({ status: "held", expires_at: 2200 })
    expect(await avail("A")).toEqual([3])
    expect(await held("A")).toEqual([2])
    expect((await svc.getHold("c1"))?.attempt).toBe(2)
  })

  it("20 lần bấm đồng thời cùng một giỏ: chỉ trừ một lần", async () => {
    await seed({ A: 5, B: 5 })
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => services[i].reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 1)] }))
    )
    expect(results.every((x) => x.status === "held")).toBe(true)
    expect(await avail("A", "B")).toEqual([3, 4])
    await expectInvariant(["A", "B"])
  })

  it("khách sửa giỏ: tăng, giảm, bỏ món, thêm món đều đúng phần chênh lệch", async () => {
    await seed({ A: 5, B: 5, C: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 3)] })
    // A 2 -> 1, bỏ B, thêm C 4.
    expect((await svc.reserve({ cart_id: "c1", lines: [line("A", 1), line("C", 4)] })).status).toBe("held")
    expect(await avail("A", "B", "C")).toEqual([4, 5, 1])
    expect(await held("A", "B", "C")).toEqual([1, 0, 4])
    const hold = await svc.getHold("c1")
    expect(hold?.lines.map((l) => l.quantity).sort()).toEqual([1, 4])
  })

  it("phần hold cũ của chính giỏ được tính là còn: giữ toàn bộ tồn rồi đổi số lượng vẫn được", async () => {
    await seed({ A: 3 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 3)] })
    expect(await avail("A")).toEqual([0])
    expect((await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })).status).toBe("held")
    expect(await avail("A")).toEqual([1])
  })

  it("giỏ mới vượt tồn: thất bại và hold cũ giữ nguyên", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 1000 })
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 6)] })).toEqual({ status: "out_of_stock", line: 0 })
    expect(await avail("A")).toEqual([3])
    const hold = await svc.getHold("c1")
    expect({ status: hold?.status, exp: hold?.expires_at, qty: hold?.lines[0].quantity }).toEqual({ status: "HELD", exp: 1900, qty: 2 })
  })

  it("sửa lỗi của repo thử: hold đã EXPIRED thì giữ lại trừ tồn thật (không trả 'đã tồn tại')", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 1000, ttl: 60 })
    expect(await svc.expireDue({ now: 2000 })).toBe(1)
    expect(await avail("A")).toEqual([5])
    expect((await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 2000 })).status).toBe("held")
    expect(await avail("A")).toEqual([3])
    expect(await held("A")).toEqual([2])
    expect(await status("c1")).toBe("HELD")
    // Hash RELEASED/EXPIRED có TTL một ngày; hold mới không được mang TTL đó.
    expect(await r.ttl(svc.keys.hold("c1"))).toBe(-1)
  })

  it("giỏ đã CONFIRMED (đã thành đơn) thì không giữ nữa", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 1)] })
    await svc.confirm("c1")
    expect(await svc.reserve({ cart_id: "c1", lines: [line("A", 1)] })).toEqual({ status: "confirmed" })
    expect(await avail("A")).toEqual([4])
  })

  it("30 lần sửa cùng một giỏ đồng thời: lần nào bỏ cuộc thì báo lỗi rõ, số tồn không bao giờ lệch", async () => {
    await seed({ A: 10, B: 10, C: 10 })
    const variants: HoldLine[][] = [
      [line("A", 2)],
      [line("A", 1), line("B", 3)],
      [line("C", 4)],
      [line("B", 1), line("C", 2), line("A", 5)],
    ]
    // Tình huống dồn ép không có ngoài đời (một giỏ chỉ gọi vài lần mỗi lúc thanh toán): một số lần gọi
    // có thể hết lượt thử lại vì hold liên tục bị lần khác đổi trước. Cho phép điều đó, nhưng chỉ với
    // đúng lỗi này, và tồn kho phải luôn khớp.
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => services[i % services.length].reserve({ cart_id: "c1", lines: variants[i % variants.length] }))
    )
    const failed = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[]
    expect(failed.every((x) => /kept changing/.test(String(x.reason)))).toBe(true)
    expect(results.some((x) => x.status === "fulfilled" && x.value.status === "held")).toBe(true)
    await expectInvariant(["A", "B", "C"])
  })
})

describe("release: trả hàng", () => {
  it("giữ rồi trả: tồn về như cũ, held 0, hold RELEASED và rời lịch hết hạn", async () => {
    await seed({ A: 5, B: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 3)] })
    expect(await svc.release("c1")).toBe("released")
    expect(await avail("A", "B")).toEqual([5, 5])
    expect(await held("A", "B")).toEqual([0, 0])
    expect(await status("c1")).toBe("RELEASED")
    expect(await r.zscore(svc.keys.expiry(), "c1")).toBeNull()
  })

  it("trả hai lần chỉ trả một lần; trả hold không tồn tại thì không làm gì", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })
    expect(await svc.release("c1")).toBe("released")
    expect(await svc.release("c1")).toBe("noop")
    expect(await svc.release("khong-co")).toBe("noop")
    expect(await avail("A")).toEqual([5])
  })

  it("20 lần trả đồng thời cùng một hold: chỉ trả đúng một lần", async () => {
    await seed({ A: 5, B: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 3), line("B", 2)] })
    const results = await Promise.all(services.map((s) => s.release("c1")))
    expect(results.filter((x) => x === "released")).toHaveLength(1)
    expect(await avail("A", "B")).toEqual([5, 5])
  })
})

describe("confirm: giỏ đã thành đơn", () => {
  it("không cộng trả avail, chỉ giảm held; trả hàng sau khi xác nhận bị từ chối", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })
    expect(await svc.confirm("c1")).toBe("confirmed")
    expect(await avail("A")).toEqual([3])
    expect(await held("A")).toEqual([0])
    expect(await svc.release("c1")).toBe("confirmed")
    expect(await avail("A")).toEqual([3])
    await expectInvariant(["A"], { A: 2 })
  })

  it("xác nhận hai lần; xác nhận hold đã trả", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 1)] })
    expect(await svc.confirm("c1")).toBe("confirmed")
    expect(await svc.confirm("c1")).toBe("already_confirmed")
    await svc.reserve({ cart_id: "c2", lines: [line("A", 1)] })
    await svc.release("c2")
    expect(await svc.confirm("c2")).toBe("not_held")
    expect(await svc.confirm("khong-co")).toBe("not_held")
  })

  it("xác nhận và trả hàng chạy đua (50 cặp): luôn đúng một bên thắng", async () => {
    for (let n = 1; n <= 50; n++) {
      await seed({ A: 5 })
      await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })
      const [c, rel] = await Promise.all([services[1].confirm("c1"), services[2].release("c1")])
      const final = await status("c1")
      if (final === "CONFIRMED") {
        expect({ n, c, rel, stock: await avail("A") }).toEqual({ n, c: "confirmed", rel: "confirmed", stock: [3] })
      } else {
        expect({ n, final, c, rel, stock: await avail("A") }).toEqual({ n, final: "RELEASED", c: "not_held", rel: "released", stock: [5] })
      }
      expect(await held("A")).toEqual([0])
    }
  })
})

describe("expireDue: hết hạn giữ chỗ", () => {
  it("chưa tới hạn thì không trả; tới hạn thì trả; chạy lại không cộng lần hai", async () => {
    await seed({ A: 5, C: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("C", 1)], now: 1000, ttl: 60 })
    expect(await svc.expireDue({ now: 1059 })).toBe(0)
    expect(await avail("A", "C")).toEqual([3, 4])
    expect(await svc.expireDue({ now: 1060 })).toBe(1)
    expect(await avail("A", "C")).toEqual([5, 5])
    expect(await status("c1")).toBe("EXPIRED")
    expect(await svc.expireDue({ now: 99999 })).toBe(0)
    expect(await avail("A", "C")).toEqual([5, 5])
  })

  it("10 job hết hạn chạy song song: mỗi hold trả đúng một lần", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 3)], now: 1000, ttl: 10 })
    await svc.reserve({ cart_id: "c2", lines: [line("A", 2)], now: 1000, ttl: 10 })
    expect(await avail("A")).toEqual([0])
    const results = await Promise.all(services.slice(0, 10).map((s) => s.expireDue({ now: 2000 })))
    expect(results.reduce((sum, x) => sum + x, 0)).toBe(2)
    expect(await avail("A")).toEqual([5])
    expect(await held("A")).toEqual([0])
  })

  it("hold đã CONFIRMED hoặc đã trả bằng tay thì job bỏ qua", async () => {
    await seed({ A: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)], now: 1000, ttl: 10 })
    await svc.reserve({ cart_id: "c2", lines: [line("A", 1)], now: 1000, ttl: 10 })
    await svc.confirm("c1")
    await svc.release("c2")
    expect(await svc.expireDue({ now: 5000 })).toBe(0)
    expect(await avail("A")).toEqual([3])
  })

  it("quy trình đầy đủ: 100 người tranh 5, 3 xác nhận, 2 bỏ: hết hạn trả 2", async () => {
    await seed({ A: 5 })
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => services[i % services.length].reserve({ cart_id: `u${i}`, lines: [line("A", 1)], now: 1000 }))
    )
    const winners = results.map((x, i) => (x.status === "held" ? `u${i}` : null)).filter(Boolean) as string[]
    expect(winners).toHaveLength(5)
    for (const cartId of winners.slice(0, 3)) {
      expect(await svc.confirm(cartId)).toBe("confirmed")
    }
    expect(await svc.expireDue({ now: 1900 })).toBe(2)
    expect(await avail("A")).toEqual([2])
    await expectInvariant(["A"], { A: 3 })
  })
})

describe("syncItem: đặt lại từ Postgres", () => {
  it("syncItems theo lô: đếm món mới và món bị lệch, trừ phần đang giữ", async () => {
    await seed({ A: 5, B: 5 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2)] })
    await r.set(svc.keys.avail(ref("B")), 99) // giả lập lệch
    const entries = [
      { ref: ref("A"), postgres_available: 5 },
      { ref: ref("B"), postgres_available: 5 },
      { ref: ref("C"), postgres_available: 7 },
      ...Array.from({ length: 1200 }, (_, i) => ({ ref: ref(`N${i}`), postgres_available: i })),
    ]
    expect(await svc.syncItems(entries)).toEqual({ synced: 1203, created: 1201, changed: 1 })
    expect(await avail("A", "B", "C", "N1199")).toEqual([3, 5, 7, 1199])
    expect(await svc.syncItems(entries)).toEqual({ synced: 1203, created: 0, changed: 0 })
  })

  it("avail = tồn Postgres − phần đang giữ", async () => {
    await seed({ A: 10 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 3)] })
    // Admin nhập thêm hàng: Postgres 10 -> 20.
    expect(await svc.syncItem(ref("A"), 20)).toBe(17)
    expect(await held("A")).toEqual([3])
  })

  it("admin giảm tồn dưới phần đang giữ: avail âm, không ai giữ thêm được", async () => {
    await seed({ A: 10 })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 4)] })
    expect(await svc.syncItem(ref("A"), 2)).toBe(-2)
    expect(await svc.reserve({ cart_id: "c2", lines: [line("A", 1)] })).toEqual({ status: "out_of_stock", line: 0 })
    // Trả hold thì về đúng tồn Postgres.
    await svc.release("c1")
    expect(await avail("A")).toEqual([2])
  })

  it("đặt lại chen giữa 60 lần giữ hàng đồng thời: không lệch số", async () => {
    await seed({ A: 30 })
    const reserves = Array.from({ length: 60 }, (_, i) => services[i % services.length].reserve({ cart_id: `s${i}`, lines: [line("A", 1)] }))
    const syncs = Array.from({ length: 20 }, (_, i) => services[(i + 7) % services.length].syncItem(ref("A"), 30))
    const results = await Promise.all([...reserves, ...syncs])
    const heldCount = results.slice(0, 60).filter((x: any) => x.status === "held").length
    expect(heldCount).toBe(30)
    expect(await avail("A")).toEqual([0])
    await expectInvariant(["A"])
  })
})

describe("Pub/Sub: phát số còn giữ được (HS-8)", () => {
  it("giữ, trả, đặt lại khi số đổi thì phát { location_id, inventory_item_id, available }; số không đổi thì không phát", async () => {
    await seed({ A: 5, B: 5 })
    const sub = new Redis(REDIS_URL)
    const messages: any[] = []
    sub.on("message", (_channel, message) => messages.push(JSON.parse(message)))
    await sub.subscribe(svc.channel)

    await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 1)] })
    await svc.reserve({ cart_id: "c1", lines: [line("A", 2), line("B", 1)] }) // gọi lại y hệt: không đổi số
    await svc.release("c1")
    await svc.syncItem(ref("A"), 5) // số không đổi
    await svc.syncItem(ref("A"), 9)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await sub.quit()

    expect(svc.channel).toBe(`${PREFIX}channel:inventory_events`)
    const msg = (item: string, available: number) => ({ location_id: LOC, inventory_item_id: item, available })
    expect(messages).toHaveLength(5)
    // Giữ hàng: theo thứ tự dòng của giỏ.
    expect(messages.slice(0, 2)).toEqual([msg("A", 3), msg("B", 4)])
    // Trả hàng: thứ tự theo field của hash, không cố định.
    expect(messages.slice(2, 4)).toEqual(expect.arrayContaining([msg("A", 5), msg("B", 5)]))
    expect(messages[4]).toEqual(msg("A", 9))
  })
})
