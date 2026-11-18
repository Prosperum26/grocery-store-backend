import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow, createSalesChannelsWorkflow,
  createRegionsWorkflow, createStockLocationsWorkflow, linkSalesChannelsToStockLocationWorkflow,
  createProductCategoriesWorkflow, createProductsWorkflow, createInventoryLevelsWorkflow,
  createPriceListsWorkflow, createOrderWorkflow,
} from "@medusajs/medusa/core-flows"
import fs from "fs"

jest.setTimeout(120 * 1000)
const OUT = process.env.SPIKE_OUT as string
const log: Record<string, unknown> = {}
const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2))
const safe = async (k: string, fn: () => Promise<unknown>) => {
  try { log[k] = await fn() } catch (e: any) { log[k] = { ERROR: e?.response?.data ?? e?.message ?? String(e) } }
  save()
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    it("spikes", async () => {
      const c = getContainer()
      const { result: [sc] } = await createSalesChannelsWorkflow(c).run({ input: { salesChannelsData: [{ name: "Web" }] } })
      const { result: [key] } = await createApiKeysWorkflow(c).run({ input: { api_keys: [{ title: "pk", type: "publishable", created_by: "" }] } })
      await linkSalesChannelsToApiKeyWorkflow(c).run({ input: { id: key.id, add: [sc.id] } })
      const { result: [region] } = await createRegionsWorkflow(c).run({ input: { regions: [{ name: "VN", currency_code: "vnd", countries: ["vn"], payment_providers: ["pp_system_default"] }] } })
      const { result: [loc] } = await createStockLocationsWorkflow(c).run({ input: { locations: [{ name: "Kho Q.7" }] } })
      await linkSalesChannelsToStockLocationWorkflow(c).run({ input: { id: loc.id, add: [sc.id] } })
      const { result: cats } = await createProductCategoriesWorkflow(c).run({ input: { product_categories: [{ name: "Rau củ", handle: "rau-cu", is_active: true }] } })
      const { result: prods } = await createProductsWorkflow(c).run({ input: { products: [{
        title: "Cà chua", handle: "ca-chua", status: "published" as any, category_ids: [cats[0].id],
        sales_channels: [{ id: sc.id }], options: [{ title: "Quy cách", values: ["500g"] }],
        variants: [{ title: "500g", sku: "CC-500", manage_inventory: true, options: { "Quy cách": "500g" }, metadata: { is_default: true },
          prices: [{ amount: 25000, currency_code: "vnd" }] }],
      }] } })
      const query = c.resolve(ContainerRegistrationKeys.QUERY)
      const { data: [v] } = await query.graph({ entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"] })
      await createInventoryLevelsWorkflow(c).run({ input: { inventory_levels: [{ inventory_item_id: v.inventory_items[0].inventory_item_id, location_id: loc.id, stocked_quantity: 10 }] } })
      const h = { headers: { "x-publishable-api-key": key.token } }

      await safe("S2_categories_variants", async () => {
        const out: any = {}
        for (const f of ["+categories", "+categories.id", "+categories.name", "+categories.handle", "categories.handle", "*categories"]) {
          const r = await api.get("/store/products?fields=" + encodeURIComponent(f), h).catch((e: any) => ({ data: { err: e.response?.data } }))
          out[f] = (r.data as any).err ?? (r.data as any).products?.[0]?.categories ?? "NO_categories_KEY"
        }
        return out
      })
      await safe("S2_db_has_category", async () => (await query.graph({ entity: "product", fields: ["id", "categories.id", "categories.handle"] })).data[0])
      // S2
      await safe("S2_products_plus_fields", async () => (await api.get("/store/products?region_id=" + region.id + "&fields=+categories.handle,+variants.metadata", h)).data.products[0])
      await safe("S2_products_categories_only", async () => (await api.get("/store/products?fields=+categories", h)).data.products[0].categories)

      // S1: chờ index có active version
      await safe("S1_manual_seed", async () => {
        const sm: any = c.resolve(Modules.SEARCH)
        const mig = await sm.createIndexMigrationPlan()
        await sm.executeIndexMigrationPlan(mig)
        const plan = await sm.createSeedPlan_()
        await sm.executeSeedPlan_(plan)
        return { mig: mig.map((m: any) => m.reason ?? m), seed: plan.map((m: any) => m.reason) }
      })
      await safe("S1_wait_index", async () => {
        for (let i = 0; i < 60; i++) {
          const r = await api.post("/store/search", { entity: "product", filters: { q: "ca" } }, h).catch((e: any) => ({ status: e.response?.status, data: e.response?.data }))
          if ((r as any).status === 200) return { tries: i }
          await new Promise((r) => setTimeout(r, 500))
        }
        return "TIMEOUT"
      })
      const body = (extra: any) => ({ entity: "product", ...extra })
      await safe("S1_search_q_in_filters", async () => (await api.post("/store/search", body({ filters: { q: "ca chua" } }), h)).data)
      await safe("S1_search_toplevel_q", async () => (await api.post("/store/search", body({ q: "ca chua" }), h)).data)
      await safe("S1_search_no_key", async () => (await api.post("/store/search", body({ filters: { q: "ca" } })).catch((e: any) => ({ status: e.response?.status, data: e.response?.data }))))
      await safe("S1_search_sort", async () => (await api.post("/store/search", body({ filters: {}, pagination: { take: 5, order: { min_price_vnd: "ASC" } }, fields: ["id", "title"] }), h)).data)

      // S7 price list + order
      await safe("S7_price_list", async () => (await createPriceListsWorkflow(c).run({ input: { price_lists_data: [{
        title: "Khuyến mãi tuần", description: "x", status: "active" as any, type: "sale" as any,
        prices: [{ variant_id: v.id, amount: 20000, currency_code: "vnd" }] }] } })).result.map((p: any) => p.id))
      await safe("S7_order", async () => {
        const { result: o } = await createOrderWorkflow(c).run({ input: {
          region_id: region.id, sales_channel_id: sc.id, currency_code: "vnd", email: "a@b.vn", status: "pending" as any,
          items: [{ variant_id: v.id, quantity: 1, title: "Cà chua", unit_price: 25000 }], metadata: { stage: "PENDING" } } as any })
        log["_orderId"] = o.id
        return { id: o.id, status: o.status }
      })
      await safe("S2_order_retrieve_metadata", async () => (await api.get(`/store/orders/${log["_orderId"]}?fields=+metadata`, h)).data.order.metadata ?? "ABSENT")

      // S3
      await safe("S3_query_graph_fulfillment_to_order", async () => {
        const { data } = await query.graph({ entity: "order", fields: ["id", "fulfillments.id"] })
        const { data: link } = await query.graph({ entity: "order_fulfillment", fields: ["order_id", "fulfillment_id"] })
        return { orders: data.length, linkEntityOk: Array.isArray(link) }
      })

      // S5
      await safe("S5_file_upload", async () => {
        const { uploadFilesWorkflow } = await import("@medusajs/medusa/core-flows")
        const { result } = await uploadFilesWorkflow(c).run({ input: { files: [{ filename: "t.txt", mimeType: "text/plain", content: Buffer.from("hi").toString("base64"), access: "public" }] } })
        return result
      })
      log["_done"] = true
      save()
    })
  },
})
