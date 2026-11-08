import { createServer } from "http"
import type { AddressInfo } from "net"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { seedDemo } from "../../src/lib/seed/seed-demo"
import { seedPromotions } from "../../src/lib/seed/seed-promotions"
import { DEMO_DATA } from "../../src/lib/seed/seed-data/demo"
import { withFixtureSkus } from "./_demo"

jest.setTimeout(300 * 1000)

const PASSWORD = "Passw0rd!"
// Trong 3 đơn DELIVERED của minhthu: trứng gà có ở cả 3 đơn (mỗi lần 1), sữa tươi ở 2 đơn (mỗi lần 2).
const EGG = "CAT-001071"
const MILK = "CAT-000115"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    // AI service giả: thứ hạng do từng bước của test quyết định.
    let aiRanking: (ids: string[]) => string[] = (ids) => ids
    let aiStatus = 200
    let aiCalls = 0
    let aiBody: any
    const aiServer = createServer((req, res) => {
      let raw = ""
      req.on("data", (chunk) => (raw += chunk))
      req.on("end", () => {
        aiCalls++
        aiBody = JSON.parse(raw)
        const ids = [...new Set<string>(aiBody.orders.flatMap((o: any) => o.lines.map((l: any) => l.product_id)))]
        res.writeHead(aiStatus, { "content-type": "application/json" })
        res.end(JSON.stringify({ items: aiRanking(ids).map((product_id) => ({ product_id })) }))
      })
    })

    beforeAll((done) => {
      aiServer.listen(0, "127.0.0.1", () => {
        process.env.AI_SERVICE_URL = `http://127.0.0.1:${(aiServer.address() as AddressInfo).port}`
        done()
      })
    })

    afterAll((done) => {
      aiServer.close(done)
    })

    describe("GET /store/predictive/reorder-basket", () => {
      it("theo thứ hạng của model, đánh dấu hết hàng, khách mới thì rỗng, AI lỗi thì rỗng", async () => {
        const container = getContainer()
        const store = await bootstrapStore(container)
        await seedCatalog(container, store)
        await seedPromotions(container, store)
        const { data, skuOf } = withFixtureSkus(DEMO_DATA)
        await seedDemo(container, store, data, PASSWORD)

        const publishable = { "x-publishable-api-key": store.publishableKey }
        const login = async (email: string) => {
          const res = await api.post("/auth/customer/emailpass", { email, password: PASSWORD })
          return { headers: { ...publishable, authorization: `Bearer ${res.data.token}` } }
        }
        const minhthu = await login("minhthu@com4fud.demo")
        const variantOf = async (v2Sku: string) =>
          (await graph({ entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"], filters: { sku: skuOf(v2Sku) } }))[0]

        const egg = await variantOf(EGG)
        const milk = await variantOf(MILK)

        // 1. Giữ đúng thứ tự của model (sữa trước trứng dù trứng mua nhiều hơn), bỏ món không có
        // trong DB, số lượng là số hay mua, tối đa 5 món.
        aiRanking = (ids) => ["variant_gone", milk.id, egg.id, ...ids.filter((id) => id !== milk.id && id !== egg.id)]
        const res = await api.get("/store/predictive/reorder-basket", minhthu)
        expect(aiCalls).toBe(1)
        expect(aiBody.top_k).toBe(14)
        expect(res.data.status).toBe("ready")
        expect(res.data.items).toHaveLength(5)
        expect(res.data.items[0]).toMatchObject({ variant_id: milk.id, quantity: 2, in_stock: true })
        expect(res.data.items[1]).toMatchObject({ variant_id: egg.id, quantity: 1, in_stock: true })
        for (const item of res.data.items) {
          expect(Object.keys(item).sort()).toEqual(
            ["art", "handle", "in_stock", "product_id", "quantity", "tint", "title", "unit_label", "unit_price", "variant_id"]
          )
          expect(item.unit_price).toBeGreaterThan(0)
        }
        const sum = (items: any[]) => items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
        expect(res.data.total).toBe(sum(res.data.items))

        // 2. Trứng hết hàng: vẫn gợi ý nhưng in_stock false và không tính vào tổng.
        const [level] = await graph({
          entity: "inventory_level",
          fields: ["id"],
          filters: { inventory_item_id: egg.inventory_items[0].inventory_item_id, location_id: store.stockLocationId },
        })
        await updateInventoryLevelsWorkflow(container).run({
          input: {
            updates: [
              {
                id: level.id,
                inventory_item_id: egg.inventory_items[0].inventory_item_id,
                location_id: store.stockLocationId,
                stocked_quantity: 0,
              },
            ],
          },
        })
        const after = await api.get("/store/predictive/reorder-basket", minhthu)
        const eggItem = after.data.items.find((i: any) => i.variant_id === egg.id)
        expect(eggItem.in_stock).toBe(false)
        expect(after.data.total).toBe(sum(after.data.items.filter((i: any) => i.in_stock)))

        // 3. Khách chưa có đơn đã giao: rỗng, không gọi model.
        const callsBefore = aiCalls
        const fresh = await api.get("/store/predictive/reorder-basket", await login("khachmoi@com4fud.demo"))
        expect(fresh.data).toEqual({ status: "empty", items: [], total: 0 })
        expect(aiCalls).toBe(callsBefore)

        // 3b. AI service lỗi: giỏ rỗng, vẫn HTTP 200.
        aiStatus = 503
        const down = await api.get("/store/predictive/reorder-basket", minhthu)
        expect(down.status).toBe(200)
        expect(down.data).toEqual({ status: "empty", items: [], total: 0 })
        aiStatus = 200

        // 4. warm trả 202 và không chờ.
        const warm = await api.post("/store/predictive/warm", {}, minhthu)
        expect(warm.status).toBe(202)

        // 5. Chưa đăng nhập: 401.
        const anon = await api.get("/store/predictive/reorder-basket", { headers: publishable }).catch((e: any) => e.response)
        expect(anon.status).toBe(401)
      })
    })
  },
})
