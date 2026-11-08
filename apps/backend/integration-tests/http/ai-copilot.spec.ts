import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"

jest.setTimeout(240 * 1000)

// Trợ lý Bếp (API-8, docs/contracts/ai-copilot.md): backend hỏi AI service rồi gắn biến thể, giá, tồn.
// AI service được thay bằng một server nhỏ trong test; catalog_id của nó dùng sku của catalog test (sku = catalog_id).
// Cần Postgres và Redis như các test hot-stock (tồn đọc từ Redis, cùng nguồn API-15).

const IN_STOCK_SKU = CATALOG[0].variants[0].sku
const OUT_OF_STOCK_SKU = CATALOG.flatMap((p) => p.variants).find((v) => v.stock === 0)!.sku
const UNKNOWN_SKU = "CAT-999999"

const item = (catalogId: string, alternatives: string[] = [], qty = 1) => ({
  ingredient: `nguyên liệu ${catalogId}`,
  kind: "core",
  raw_text: catalogId,
  need: { quantity: 500, unit: "g", scaled_for: 4 },
  product: { catalog_id: catalogId, name: `SP ${catalogId}`, category: null, pack_size: 300, pack_unit: "g" },
  derived: false,
  default_qty: qty,
  pack_hint: 2,
  alternatives: alternatives.map((id) => ({ catalog_id: id, name: `Thay ${id}` })),
})

const searchData = (results: unknown[] = [
  {
    recipe: { id: "canh-chua", name: "Canh chua", family: null, servings: 4, time_minutes: 30, difficulty: null, description: null, image_url: null, source_url: "u" },
    score: 0.7,
    matched_by: "both",
    complete: true,
    basket: { buy: [item(IN_STOCK_SKU, [OUT_OF_STOCK_SKU])], maybe_have: [item(UNKNOWN_SKU, [], 0)] },
  },
]) => ({ query: "canh chua", servings: 4, accepted: results.length > 0, threshold: 0.64, results })

const COPILOT_AI = {
  provider: "gemini", model: "m", recipe_id: "canh-chua", explanation: "Hợp vì đúng món.",
  item_notes: [], prep_notes: [], follow_up_question: null,
}

type Behaviour = "ok" | "copilot-down" | "all-down" | "empty"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Trợ lý Bếp (API-8)", () => {
      let ai: Server
      let behaviour: Behaviour = "ok"
      let seen: { url: string; key: string | undefined; body: any }[] = []

      beforeAll(async () => {
        ai = createServer(async (req: IncomingMessage, res) => {
          let raw = ""
          for await (const chunk of req) raw += chunk
          seen.push({ url: req.url!, key: req.headers["x-internal-key"] as string | undefined, body: JSON.parse(raw || "{}") })
          const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
          if (behaviour === "all-down" || (behaviour === "copilot-down" && req.url === "/api/v1/copilot")) {
            return send(503, { detail: "down" })
          }
          if (req.url === "/api/v1/recipe" || req.url === "/api/v1/ask") {
            if (raw.includes("khong-co")) return send(404, { detail: "unknown" })
            if (req.url === "/api/v1/ask") return send(200, { answer: "Khoảng 300 kcal (ước tính).", status: "ok", provider: "p", model: "m", latency_ms: 5 })
            const [first] = searchData().results as any[]
            return send(200, { recipe: first.recipe, servings: 4, complete: true, prep_steps: ["Sơ chế"], cooking_steps: ["Nấu"], basket: first.basket, not_in_basket: ["lá giang"] })
          }
          const data = searchData(behaviour === "empty" ? [] : undefined)
          send(200, req.url === "/api/v1/copilot" ? { data, ai: COPILOT_AI, ai_status: "ok", latency_ms: 5 } : data)
        })
        await new Promise<void>((resolve) => ai.listen(0, "127.0.0.1", resolve))
        process.env.AI_SERVICE_URL = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`
        process.env.AI_INTERNAL_KEY = "test-internal-key"
      })
      afterAll(async () => {
        await new Promise((resolve) => ai.close(resolve))
      })
      beforeEach(() => {
        behaviour = "ok"
        seen = []
      })

      async function setup() {
        const store = await bootstrapStore(getContainer())
        await seedCatalog(getContainer(), { regionId: store.regionId, salesChannelId: store.salesChannelId, stockLocationId: store.stockLocationId })
        const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
        const post = (url: string, body: unknown, options: any = headers) => api.post(url, body, options).catch((e: any) => e.response)
        return { post, headers }
      }

      it("/store/ai/search gắn biến thể, giá và tồn vào sản phẩm chính và phương án thay thế", async () => {
        const { post } = await setup()
        const res = await post("/store/ai/search", { query: "canh chua", servings: 4, have: ["muối"] })
        expect(res.status).toBe(200)

        const [result] = res.data.results
        const main = result.basket.buy[0]
        expect(main.variant).toMatchObject({ unit_label: expect.any(String), purchasable: true })
        expect(main.variant.available).toBeGreaterThan(0)
        expect(main.variant.unit_price).toBeGreaterThan(0)
        expect(main.variant.variant_id).toMatch(/^variant_/)

        // Phương án thay thế hết hàng: có biến thể nhưng không mua được
        expect(main.alternatives[0].variant).toMatchObject({ available: 0, purchasable: false })
        // catalog_id không có trong Medusa: variant null, vẫn giữ tên
        expect(result.basket.maybe_have[0]).toMatchObject({ variant: null, product: { name: `SP ${UNKNOWN_SKU}` }, default_qty: 0 })
        // Các trường của AI giữ nguyên
        expect(main).toMatchObject({ default_qty: 1, pack_hint: 2, derived: false })

        // AI service nhận đúng body và khóa nội bộ
        expect(seen).toEqual([{ url: "/api/v1/search", key: "test-internal-key", body: { query: "canh chua", servings: 4, have: ["muối"] } }])
      })

      it("/store/ai/copilot trả lời AI cùng dữ liệu đã gắn biến thể", async () => {
        const { post } = await setup()
        const res = await post("/store/ai/copilot", { query: "canh chua" })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ ai_status: "ok", ai: { provider: "gemini", recipe_id: "canh-chua" } })
        expect(res.data.data.results[0].basket.buy[0].variant.purchasable).toBe(true)
        expect(seen.map((s) => s.url)).toEqual(["/api/v1/copilot"])
      })

      it("copilot lỗi thì dùng /search: vẫn có món và giỏ, ai null", async () => {
        const { post } = await setup()
        behaviour = "copilot-down"
        const res = await post("/store/ai/copilot", { query: "canh chua" })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ ai: null, ai_status: "fallback_error" })
        expect(res.data.data.results[0].basket.buy[0].variant.purchasable).toBe(true)
        expect(seen.map((s) => s.url)).toEqual(["/api/v1/copilot", "/api/v1/search"])
      })

      it("AI service sập hẳn: 503 AI_UNAVAILABLE cho cả hai route", async () => {
        const { post } = await setup()
        behaviour = "all-down"
        for (const url of ["/store/ai/search", "/store/ai/copilot"]) {
          const res = await post(url, { query: "canh chua" })
          expect({ url, status: res.status, code: res.data.code }).toEqual({ url, status: 503, code: "AI_UNAVAILABLE" })
        }
      })

      it("/store/ai/recipe trả các bước và giỏ đã gắn biến thể; món lạ là 404", async () => {
        const { post } = await setup()
        const res = await post("/store/ai/recipe", { recipe_id: "canh-chua", servings: 4 })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ cooking_steps: ["Nấu"], prep_steps: ["Sơ chế"], not_in_basket: ["lá giang"] })
        expect(res.data.basket.buy[0].variant).toMatchObject({ purchasable: true })
        expect(res.data.basket.buy[0].alternatives[0].variant).toMatchObject({ purchasable: false })
        expect(res.data.basket.maybe_have[0].variant).toBeNull()
        expect(seen[0]).toMatchObject({ url: "/api/v1/recipe", key: "test-internal-key", body: { recipe_id: "canh-chua", servings: 4 } })

        const missing = await post("/store/ai/recipe", { recipe_id: "khong-co" })
        expect({ status: missing.status, code: missing.data.code }).toEqual({ status: 404, code: "AI_RECIPE_NOT_FOUND" })
      })

      it("/store/ai/ask chuyển câu hỏi và trả câu trả lời; sập là 503; body sai là 400", async () => {
        const { post } = await setup()
        const res = await post("/store/ai/ask", { recipe_id: "canh-chua", question: "calo?" })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ answer: expect.stringContaining("kcal"), status: "ok" })
        expect(seen[0].body).toEqual({ recipe_id: "canh-chua", question: "calo?" })

        expect((await post("/store/ai/ask", { recipe_id: "khong-co", question: "q" })).status).toBe(404)
        expect((await post("/store/ai/ask", { recipe_id: "canh-chua", question: "  " })).status).toBe(400)
        expect((await post("/store/ai/recipe", { recipe_id: "" })).status).toBe(400)

        behaviour = "all-down"
        const down = await post("/store/ai/ask", { recipe_id: "canh-chua", question: "calo?" })
        expect({ status: down.status, code: down.data.code }).toEqual({ status: 503, code: "AI_UNAVAILABLE" })
      })

      it("không có món nào (accepted: false) vẫn trả 200 với danh sách rỗng", async () => {
        const { post } = await setup()
        behaviour = "empty"
        const res = await post("/store/ai/search", { query: "món không tồn tại" })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ accepted: false, results: [] })
      })

      it("body sai: 400; thiếu publishable key: 400; route cũ không còn", async () => {
        const { post } = await setup()
        const cases: [string, unknown][] = []
        for (const url of ["/store/ai/search", "/store/ai/copilot"]) {
          cases.push(
            [url, {}],
            [url, { query: "   " }],
            [url, { query: "x".repeat(301) }],
            [url, { query: "canh chua", servings: 0 }],
            [url, { query: "canh chua", top_k: 11 }],
            [url, { query: "canh chua", have: "cà chua" }]
          )
        }
        for (const [url, body] of cases) {
          const res = await post(url, body)
          expect({ url, body, status: res.status }).toEqual({ url, body, status: 400 })
        }
        expect(seen).toEqual([]) // body sai bị chặn trước khi gọi AI

        const noKey = await post("/store/ai/search", { query: "canh chua" }, { headers: {} })
        expect(noKey.status).toBe(400)

        for (const old of ["/store/recipes/semantic-search", "/store/assistant/chat"]) {
          expect({ old, status: (await post(old, { query: "x", message: "x" })).status }).toEqual({ old, status: 404 })
        }
      })
    })
  },
})
