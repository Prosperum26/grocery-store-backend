import { BASKET_TTL_SECONDS, basketKey, cachedRanking, historyVersion, type CacheRedis } from "../cache"

const fakeRedis = () => {
  const data = new Map<string, string>()
  const ttl = new Map<string, number>()
  const redis = {
    get: jest.fn(async (k: string) => data.get(k) ?? null),
    set: jest.fn(async (k: string, v: string, _mode: "EX", s: number) => {
      data.set(k, v)
      ttl.set(k, s)
    }),
    expire: jest.fn(async (k: string, s: number) => void ttl.set(k, s)),
  }
  return { redis: redis as CacheRedis & typeof redis, data, ttl }
}

describe("reorder cache", () => {
  const key = basketKey("c4f-test:", "cus_1")

  it("names the key per customer", () => {
    expect(key).toBe("c4f-test:basket:cus_1")
  })

  it("history version changes with a new delivered order", () => {
    const two = [{ placed_at: "2026-11-01T00:00:00Z" }, { placed_at: "2026-11-05T00:00:00Z" }]
    expect(historyVersion(two)).toBe("2:2026-11-05T00:00:00Z")
    expect(historyVersion([...two, { placed_at: "2026-11-10T00:00:00Z" }])).not.toBe(historyVersion(two))
  })

  it("first call asks the model and stores the ranking for 30 minutes; the next one reads Redis", async () => {
    const { redis, ttl } = fakeRedis()
    const compute = jest.fn(async () => ["v1", "v2"])
    expect(await cachedRanking(redis, key, "2:x", compute)).toEqual({ ranking: ["v1", "v2"], source: "model" })
    expect(ttl.get(key)).toBe(BASKET_TTL_SECONDS)
    expect(await cachedRanking(redis, key, "2:x", compute)).toEqual({ ranking: ["v1", "v2"], source: "cache" })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(redis.expire).toHaveBeenCalledWith(key, BASKET_TTL_SECONDS) // reading refreshes the TTL
  })

  it("asks the model again when the history changed", async () => {
    const { redis } = fakeRedis()
    await cachedRanking(redis, key, "2:x", async () => ["old"])
    const out = await cachedRanking(redis, key, "3:y", async () => ["new"])
    expect(out).toEqual({ ranking: ["new"], source: "model" })
  })

  it("does not store an empty ranking (model down), so the next call tries again", async () => {
    const { redis, data } = fakeRedis()
    await cachedRanking(redis, key, "2:x", async () => [])
    expect(data.has(key)).toBe(false)
  })

  it("still answers when Redis fails or is missing", async () => {
    const broken = {
      get: async () => {
        throw new Error("down")
      },
      set: async () => {
        throw new Error("down")
      },
      expire: async () => undefined,
    }
    const errors: string[] = []
    expect(await cachedRanking(broken, key, "1:x", async () => ["v1"], (m) => errors.push(m))).toEqual({ ranking: ["v1"], source: "model" })
    expect(errors).toHaveLength(2)
    expect(await cachedRanking(null, key, "1:x", async () => ["v1"])).toEqual({ ranking: ["v1"], source: "model" })
  })
})
