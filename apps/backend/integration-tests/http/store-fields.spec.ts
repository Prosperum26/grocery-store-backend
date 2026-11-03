import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"

jest.setTimeout(180 * 1000)

// Store API v2.21 lược im lặng field ngoài `allowed` của route (V1, V2).
// BE-3a mở thêm bằng allowFields trong src/api/middlewares.ts.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Store API allowFields", () => {
      it("returns categories.handle and variants.metadata on /store/products", async () => {
        const container = getContainer()
        const store = await bootstrapStore(container)
        await seedCatalog(container, {
          regionId: store.regionId,
          salesChannelId: store.salesChannelId,
          stockLocationId: store.stockLocationId,
        })

        const res = await api.get(
          "/store/products?limit=100&fields=+categories.id,+categories.handle,+categories.name,+variants.metadata",
          { headers: { "x-publishable-api-key": store.publishableKey } }
        )
        const products: any[] = res.data.products
        expect(products.length).toBeGreaterThan(0)

        for (const p of products) {
          expect(typeof p.categories?.[0]?.handle).toBe("string")
          expect(typeof p.categories[0].id).toBe("string")
          expect(typeof p.categories[0].name).toBe("string")
          // Mỗi sản phẩm có đúng một biến thể mặc định.
          expect(p.variants.filter((v: any) => v.metadata?.is_default === true)).toHaveLength(1)
        }
      })

      it("returns metadata.stage on /store/orders/:id", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const store = await bootstrapStore(container)
        await seedCatalog(container, {
          regionId: store.regionId,
          salesChannelId: store.salesChannelId,
          stockLocationId: store.stockLocationId,
        })

        const { data: variants } = await query.graph({
          entity: "product_variant",
          fields: ["id"],
          pagination: { take: 1 },
        })

        // createOrderWorkflow không phát order.placed nên đặt stage thủ công (BE-6 chưa có).
        const { result: order } = await createOrderWorkflow(container).run({
          input: {
            region_id: store.regionId,
            sales_channel_id: store.salesChannelId,
            currency_code: "vnd",
            email: "khach@example.com",
            status: "pending",
            items: [{ variant_id: variants[0].id, quantity: 1, title: "Cà chua", unit_price: 25000 }],
            metadata: { stage: "PENDING" },
          } as any,
        })

        const res = await api.get(`/store/orders/${order.id}?fields=+metadata`, {
          headers: { "x-publishable-api-key": store.publishableKey },
        })
        expect(res.data.order.metadata?.stage).toBe("PENDING")
      })
    })
  },
})
