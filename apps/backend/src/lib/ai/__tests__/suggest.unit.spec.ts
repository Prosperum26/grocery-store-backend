import { MedusaError } from "@medusajs/framework/utils"
import type { AiBasketItem, AiSuggestResponse, AiSuggestion, StoreVariantInfo } from "../../../types/ai"
import { AI_UNAVAILABLE, aiSuggestByProducts } from "../client"
import { catalogIdsOfSuggestions, discoverSeed, shapeSuggestions, vietnamDay } from "../suggest"

const item = (catalogId: string, qty = 1): AiBasketItem => ({
  ingredient: `nl ${catalogId}`,
  kind: "core",
  raw_text: catalogId,
  need: null,
  product: { catalog_id: catalogId, name: `SP ${catalogId}`, category: null, pack_size: 300, pack_unit: "g" },
  derived: false,
  default_qty: qty,
  pack_hint: null,
  alternatives: [],
})

const suggestion = (id: string, buy: AiBasketItem[]): AiSuggestion => ({
  recipe: { id, name: id, family: null, servings: 4, time_minutes: 30, difficulty: null, description: null, image_url: null, source_url: "u" },
  matched: [{ catalog_id: "CAT-1", name: "cá lóc" }],
  new_count: null,
  familiar_count: null,
  missing_count: buy.length,
  basket: { buy, maybe_have: [] },
})

const variant = (sku: string, price: number, available: number): StoreVariantInfo => ({
  variant_id: `v-${sku}`,
  product_id: `p-${sku}`,
  handle: sku,
  thumbnail: null,
  title: sku,
  unit_label: "gói",
  unit_price: price,
  available,
  purchasable: available > 0,
})

const infoOf = (...variants: [string, number, number][]) => new Map(variants.map(([sku, price, available]) => [sku, variant(sku, price, available)]))

const DATA: AiSuggestResponse = {
  suggestions: [
    suggestion("a", [item("CAT-1"), item("CAT-2", 2)]),
    suggestion("b", [item("CAT-3")]),
    suggestion("c", [item("CAT-1")]),
    suggestion("d", [item("CAT-1")]),
  ],
}

describe("shapeSuggestions", () => {
  it("gom mọi catalog_id của các giỏ, không trùng", () => {
    expect(catalogIdsOfSuggestions(DATA).sort()).toEqual(["CAT-1", "CAT-2", "CAT-3"])
  })

  it("bỏ món có dòng cần mua hết hàng hoặc chưa mở bán, giữ thứ tự của AI", () => {
    const info = infoOf(["CAT-1", 10000, 5], ["CAT-2", 5000, 5], ["CAT-3", 7000, 0]) // CAT-3 hết hàng
    const out = shapeSuggestions(DATA, info, 3)
    expect(out.status).toBe("ready")
    expect(out.suggestions.map((s) => s.recipe.id)).toEqual(["a", "c", "d"])
  })

  it("món có sản phẩm chưa mở bán (không có biến thể) cũng bị bỏ", () => {
    const out = shapeSuggestions({ suggestions: [DATA.suggestions[1]] }, infoOf(["CAT-1", 1, 1]), 3)
    expect(out).toEqual({ status: "empty", suggestions: [] })
  })

  it("missing_total = tổng đơn giá x số gói như nút Thêm (pack_hint, không có thì default_qty)", () => {
    const out = shapeSuggestions({ suggestions: [DATA.suggestions[0]] }, infoOf(["CAT-1", 10000, 5], ["CAT-2", 5000, 5]), 3)
    expect(out.suggestions[0].missing_total).toBe(10000 * 1 + 5000 * 2)
    const hinted = { ...item("CAT-1"), pack_hint: 3 }
    const withHint = shapeSuggestions({ suggestions: [suggestion("h", [hinted])] }, infoOf(["CAT-1", 10000, 5]), 3)
    expect(withHint.suggestions[0].missing_total).toBe(30000)
  })

  it("cắt còn `keep` món và gắn biến thể vào giỏ", () => {
    const info = infoOf(["CAT-1", 10000, 5], ["CAT-2", 5000, 5])
    const out = shapeSuggestions(DATA, info, 1)
    expect(out.suggestions).toHaveLength(1)
    expect(out.suggestions[0].basket.buy[0].variant?.variant_id).toBe("v-CAT-1")
  })

  it("giỏ không còn dòng nào cần mua thì món vẫn hợp lệ với tổng 0 (đã đủ nguyên liệu)", () => {
    const out = shapeSuggestions({ suggestions: [suggestion("z", [])] }, new Map(), 3)
    expect(out.suggestions[0]).toMatchObject({ missing_count: 0, missing_total: 0 })
  })
})

describe("aiSuggestByProducts", () => {
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://ai.test:8100"
    process.env.AI_INTERNAL_KEY = "k"
  })

  it("gọi /api/v1/suggest/by-products với khoá nội bộ", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(DATA), { status: 200 })
    }) as unknown as typeof fetch
    const out = await aiSuggestByProducts({ catalog_ids: ["CAT-1"], mode: "cart", limit: 9 }, impl)
    expect(out.suggestions).toHaveLength(4)
    expect(calls[0].url).toBe("http://ai.test:8100/api/v1/suggest/by-products")
    expect((calls[0].init.headers as Record<string, string>)["x-internal-key"]).toBe("k")
  })

  it("AI service lỗi hoặc body sai thì AI_UNAVAILABLE", async () => {
    for (const response of [new Response("x", { status: 503 }), new Response(JSON.stringify({ nope: 1 }), { status: 200 })]) {
      const impl = (async () => response) as unknown as typeof fetch
      const error = await aiSuggestByProducts({ catalog_ids: ["CAT-1"], mode: "cart" }, impl).then(() => null, (e) => e)
      expect(MedusaError.isMedusaError(error) && error.code).toBe(AI_UNAVAILABLE)
    }
  })
})

describe("discoverSeed", () => {
  it("đổi ngày lúc nửa đêm giờ Việt Nam, không phải nửa đêm UTC", () => {
    expect(vietnamDay(new Date("2026-11-13T16:59:00Z"))).toBe("2026-11-13") // 23:59 giờ VN
    expect(vietnamDay(new Date("2026-11-13T17:00:00Z"))).toBe("2026-11-14") // 00:00 giờ VN
  })

  it("cùng khách cùng ngày cho cùng hạt giống; khách chưa đăng nhập dùng guest", () => {
    const now = new Date("2026-11-13T05:00:00Z")
    expect(discoverSeed("cus_1", now)).toBe("cus_1:2026-11-13")
    expect(discoverSeed("cus_1", new Date("2026-11-13T09:00:00Z"))).toBe(discoverSeed("cus_1", now))
    expect(discoverSeed(undefined, now)).toBe("guest:2026-11-13")
  })
})
