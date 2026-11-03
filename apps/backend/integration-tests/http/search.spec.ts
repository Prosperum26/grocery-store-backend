import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createReservationsWorkflow, updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { waitFor, waitForSearchReady } from "./_helpers"

jest.setTimeout(240 * 1000)

// Index nạp qua event bus bất đồng bộ; máy chậm cần hơn 5 giây mặc định của waitFor.
const WAIT_MS = 30000

// Sản phẩm hết hàng và sản phẩm khuyến mãi lấy từ chính CATALOG, không hard-code.
const OUT_OF_STOCK = CATALOG.filter((p) => p.variants.every((v) => v.stock === 0)).map((p) => p.handle)
const ON_SALE = CATALOG.filter((p) => p.variants.some((v) => v.salePriceVnd !== undefined)).map((p) => p.handle)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    // Hình dạng request theo verified-apis S1: từ khoá ở filters.q, hit nằm ở results[0].hits[].document.
    const searchDocs = async (headers: any, body: Record<string, unknown>): Promise<any[]> => {
      const res = await api.post("/store/search", { entity: "product", ...body }, headers)
      return res.data.results[0].hits.map((hit: any) => hit.document)
    }

    const inventoryItemIdOf = async (container: any, sku: string): Promise<string> => {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { sku },
      })
      return (data[0] as any).inventory_items[0].inventory_item_id
    }

    // Dựng cửa hàng + catalog, chờ index nhận đủ sản phẩm.
    async function setup() {
      const container = getContainer()
      const store = await bootstrapStore(container)
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
      await waitForSearchReady(container, async () => {
        const res = await api
          .post("/store/search", { entity: "product", filters: {} }, headers)
          .catch((e: any) => e.response)
        return res.status
      })
      await seedCatalog(container, {
        regionId: store.regionId,
        salesChannelId: store.salesChannelId,
        stockLocationId: store.stockLocationId,
      })
      await waitFor(
        async () =>
          (await searchDocs(headers, { filters: {}, pagination: { take: 100 } })).length === CATALOG.length
            ? true
            : undefined,
        { timeoutMs: WAIT_MS }
      )
      return { container, store, headers }
    }

    describe("/store/search", () => {
      it("tìm không dấu 'ca chua' ra 'Cà chua'", async () => {
        const { headers } = await setup()
        const docs = await searchDocs(headers, { filters: { q: "ca chua" }, fields: ["id", "title"] })
        expect(docs.some((d) => d.title.startsWith("Cà chua"))).toBe(true)
      })

      it("lọc in_stock=true bỏ sản phẩm tồn 0, và trả lại sau khi nâng tồn", async () => {
        const { container, store, headers } = await setup()
        expect(OUT_OF_STOCK.length).toBeGreaterThan(0)
        const handlesInStock = async () =>
          (
            await searchDocs(headers, {
              filters: { in_stock: true },
              fields: ["id", "handle"],
              pagination: { take: 100 },
            })
          ).map((d) => d.handle)

        // Chờ index tính xong in_stock cho toàn bộ catalog.
        const before = await waitFor(
          async () => {
            const handles = await handlesInStock()
            return handles.length === CATALOG.length - OUT_OF_STOCK.length ? handles : undefined
          },
          { timeoutMs: WAIT_MS }
        )
        for (const handle of OUT_OF_STOCK) {
          expect(before).not.toContain(handle)
        }

        // Nâng tồn của sản phẩm hết hàng qua workflow (phát inventory-level.updated).
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const target = CATALOG.find((p) => p.handle === OUT_OF_STOCK[0])!
        const inventoryItemId = await inventoryItemIdOf(container, target.variants[0].sku)
        const { data: levels } = await query.graph({
          entity: "inventory_level",
          fields: ["id", "inventory_item_id", "location_id"],
          filters: { inventory_item_id: inventoryItemId, location_id: store.stockLocationId },
        })
        await updateInventoryLevelsWorkflow(container).run({
          input: {
            updates: [
              {
                id: levels[0].id,
                inventory_item_id: inventoryItemId,
                location_id: store.stockLocationId,
                stocked_quantity: 5,
              },
            ],
          },
        })

        const after = await waitFor(
          async () => {
            const handles = await handlesInStock()
            return handles.includes(target.handle) ? handles : undefined
          },
          { timeoutMs: WAIT_MS }
        )
        expect(after).toContain(target.handle)
      })

      it("giữ chỗ hết số tồn thì sản phẩm rời bộ lọc in_stock=true", async () => {
        const { container, store, headers } = await setup()
        // Sản phẩm một biến thể còn hàng: giữ chỗ toàn bộ tồn thì tồn khả dụng về 0.
        const target = CATALOG.find((p) => p.variants.length === 1 && p.variants[0].stock > 0)!
        const handlesInStock = async () =>
          (
            await searchDocs(headers, {
              filters: { in_stock: true },
              fields: ["id", "handle"],
              pagination: { take: 100 },
            })
          ).map((d) => d.handle)
        await waitFor(async () => ((await handlesInStock()).includes(target.handle) ? true : undefined), {
          timeoutMs: WAIT_MS,
        })

        await createReservationsWorkflow(container).run({
          input: {
            reservations: [
              {
                inventory_item_id: await inventoryItemIdOf(container, target.variants[0].sku),
                location_id: store.stockLocationId,
                quantity: target.variants[0].stock,
              },
            ],
          },
        })

        const after = await waitFor(
          async () => {
            const handles = await handlesInStock()
            return handles.includes(target.handle) ? undefined : handles
          },
          { timeoutMs: WAIT_MS }
        )
        expect(after).not.toContain(target.handle)
      })

      it("lọc on_sale_vnd=true đúng các sản phẩm có price list", async () => {
        const { headers } = await setup()
        // Price list không phát event; seedCatalog phát product.updated nên chờ index nhận.
        const handles = await waitFor(
          async () => {
            const found = (
              await searchDocs(headers, {
                filters: { on_sale_vnd: true },
                fields: ["id", "handle"],
                pagination: { take: 100 },
              })
            ).map((d) => d.handle)
            return found.length === ON_SALE.length ? found : undefined
          },
          { timeoutMs: WAIT_MS }
        )
        expect([...handles].sort()).toEqual([...ON_SALE].sort())
      })

      it("sắp xếp theo min_price_vnd tăng dần", async () => {
        const { headers } = await setup()
        const docs = await searchDocs(headers, {
          filters: {},
          fields: ["id", "min_price_vnd"],
          pagination: { take: 100, order: { min_price_vnd: "ASC" } },
        })
        const prices = docs.map((d) => d.min_price_vnd)
        expect(prices).toHaveLength(CATALOG.length)
        expect(prices).toEqual([...prices].sort((a, b) => a - b))
      })

      it("thiếu publishable key thì bị từ chối bằng 4xx", async () => {
        await setup()
        const res = await api
          .post("/store/search", { entity: "product", filters: { q: "ca" } })
          .catch((e: any) => e.response)
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
      })
    })
  },
})
