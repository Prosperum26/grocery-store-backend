import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"

jest.setTimeout(180 * 1000)

const CATEGORY_HANDLES = [
  "rau-cu", "trai-cay", "thit", "hai-san", "trung-sua", "gao-do-kho", "gia-vi", "do-uong",
]

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("seedCatalog", () => {
      it("seeds a real catalog idempotently", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const store = await bootstrapStore(container)
        const ctx = {
          regionId: store.regionId,
          salesChannelId: store.salesChannelId,
          stockLocationId: store.stockLocationId,
        }

        const first = await seedCatalog(container, ctx)
        const countProducts = async () =>
          (await query.graph({ entity: "product", fields: ["id"] })).data.length
        const afterFirst = await countProducts()
        expect(first.created).toBe(afterFirst)
        expect(first.skipped).toBe(0)

        const second = await seedCatalog(container, ctx)
        expect(second.created).toBe(0)
        expect(second.skipped).toBe(afterFirst)
        expect(await countProducts()).toBe(afterFirst)

        // Danh mục không bị nhân đôi.
        const cats = (await query.graph({ entity: "product_category", fields: ["handle"] })).data as any[]
        expect(cats.map((c) => c.handle).sort()).toEqual([...CATEGORY_HANDLES].sort())

        // Đọc qua Store API như storefront.
        const res = await api.get(
          `/store/products?limit=100&region_id=${ctx.regionId}` +
            "&fields=*categories,+variants.calculated_price,+variants.inventory_quantity,+variants.weight,+metadata",
          { headers: { "x-publishable-api-key": store.publishableKey } }
        )
        const products: any[] = res.data.products
        expect(products).toHaveLength(afterFirst)

        // Mỗi danh mục >= 3 sản phẩm (gồm do-uong).
        for (const handle of CATEGORY_HANDLES) {
          const n = products.filter((p) => p.categories.some((c: any) => c.handle === handle)).length
          expect({ handle, ok: n >= 3 }).toEqual({ handle, ok: true })
        }

        for (const p of products) {
          // metadata số
          expect(typeof p.metadata.stock_unit).toBe("string")
          expect(typeof p.metadata.low_stock).toBe("number")
          // option "Quy cách"
          expect(p.options.map((o: any) => o.title)).toEqual(["Quy cách"])
          // đúng một biến thể mặc định
          expect(p.variants.filter((v: any) => v.metadata?.is_default === true)).toHaveLength(1)
          for (const v of p.variants) {
            expect(v.weight).toBeGreaterThan(0)
            expect(v.options).toHaveLength(1)
          }
        }

        const stockOf = (p: any) =>
          p.variants.reduce((sum: number, v: any) => sum + (v.inventory_quantity ?? 0), 0)

        // Có sản phẩm hết hàng và sản phẩm sắp hết (0 < tồn <= low_stock).
        expect(products.some((p) => stockOf(p) === 0)).toBe(true)
        expect(products.some((p) => stockOf(p) > 0 && stockOf(p) <= p.metadata.low_stock)).toBe(true)

        // Có khuyến mãi: giá gốc cao hơn giá tính.
        const onSale = products.flatMap((p) => p.variants).filter(
          (v: any) => v.calculated_price.original_amount > v.calculated_price.calculated_amount
        )
        expect(onSale.length).toBeGreaterThan(0)
      })
    })
  },
})
