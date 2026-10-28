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

    describe("GET /store/predictive/reorder-basket", () => {
      it("gợi ý theo tần suất mua, đánh dấu hết hàng, khách mới thì rỗng", async () => {
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

        // 1. Khách có đơn đã giao: 5 món, món mua nhiều lần nhất đứng đầu, số lượng là số hay mua.
        const res = await api.get("/store/predictive/reorder-basket", minhthu)
        expect(res.data.status).toBe("ready")
        expect(res.data.items).toHaveLength(5)
        const egg = await variantOf(EGG)
        const milk = await variantOf(MILK)
        expect(res.data.items[0]).toMatchObject({ variant_id: egg.id, quantity: 1, in_stock: true })
        expect(res.data.items[1]).toMatchObject({ variant_id: milk.id, quantity: 2, in_stock: true })
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

        // 3. Khách chưa có đơn đã giao.
        const fresh = await api.get("/store/predictive/reorder-basket", await login("khachmoi@com4fud.demo"))
        expect(fresh.data).toEqual({ status: "empty", items: [], total: 0 })

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
