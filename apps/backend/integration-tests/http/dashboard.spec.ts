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

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    describe("Admin dashboard (BE-11)", () => {
      it("tổng quan tính theo đơn thật, sắp cạn kho theo ngưỡng low_stock, cần đăng nhập admin", async () => {
        const container = getContainer()
        const store = await bootstrapStore(container)
        await seedCatalog(container, store)
        await seedPromotions(container, store)
        const { data } = withFixtureSkus(DEMO_DATA)
        await seedDemo(container, store, data, PASSWORD)

        const login = await api.post("/auth/user/emailpass", { email: DEMO_DATA.admin_email, password: PASSWORD })
        const admin = { headers: { authorization: `Bearer ${login.data.token}` } }

        // 1. Tổng quan: mọi đơn demo vừa tạo nằm trong 7 ngày; đơn huỷ không tính.
        const orders = await graph({ entity: "order", fields: ["id", "status", "total"] })
        const counted = orders.filter((o) => o.status !== "canceled")
        const expectedRevenue = counted.reduce((sum, o) => sum + Number(o.total), 0)

        const summary = (await api.get("/admin/dashboard/summary", admin)).data
        expect(Object.keys(summary).sort()).toEqual(["aov", "low_stock_count", "orders_today", "revenue_7d", "revenue_today"])
        expect(summary.revenue_7d).toHaveLength(7)
        expect(summary.revenue_7d.reduce((a: number, b: number) => a + b, 0)).toBe(expectedRevenue)
        expect(summary.aov).toBe(Math.round(expectedRevenue / counted.length))
        // Đơn được tạo lúc chạy test, nên là đơn hôm nay (trừ khi test chạy đúng lúc qua nửa đêm giờ VN).
        expect(summary.revenue_today).toBe(summary.revenue_7d[6])

        // 2. Sắp cạn kho: đếm khớp với tổng quan, ít hàng nhất trước, mọi dòng <= ngưỡng.
        const low = (await api.get("/admin/dashboard/low-stock?limit=100", admin)).data
        expect(low.count).toBe(summary.low_stock_count)
        expect(low.items.length).toBe(low.count)
        for (const item of low.items) {
          expect(item.available).toBeLessThanOrEqual(item.low_stock)
        }
        const available = low.items.map((i: any) => i.available)
        expect(available).toEqual([...available].sort((a, b) => a - b))

        // 3. Đưa một món nhiều hàng về 0: nó vào danh sách, đứng đầu, số đếm tăng 1.
        const listed = new Set(low.items.map((i: any) => i.sku))
        const [target] = await graph({
          entity: "product_variant",
          fields: ["sku", "inventory_items.inventory_item_id"],
          filters: { sku: "RC-0112" }, // cà chua của bộ 32 món, tồn 86
        })
        expect(listed.has(target.sku)).toBe(false)
        const inventoryItemId = target.inventory_items[0].inventory_item_id
        const [level] = await graph({
          entity: "inventory_level",
          fields: ["id"],
          filters: { inventory_item_id: inventoryItemId, location_id: store.stockLocationId },
        })
        await updateInventoryLevelsWorkflow(container).run({
          input: {
            updates: [
              { id: level.id, inventory_item_id: inventoryItemId, location_id: store.stockLocationId, stocked_quantity: 0 },
            ],
          },
        })
        const after = (await api.get("/admin/dashboard/low-stock?limit=1", admin)).data
        expect(after.count).toBe(low.count + 1)
        expect(after.items).toHaveLength(1)
        expect(after.items[0].available).toBe(0)

        // 4. Chưa đăng nhập admin: 401.
        for (const url of ["/admin/dashboard/summary", "/admin/dashboard/low-stock"]) {
          const res = await api.get(url).catch((e: any) => e.response)
          expect({ url, status: res.status }).toEqual({ url, status: 401 })
        }
      })
    })
  },
})
