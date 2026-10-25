import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow, createSalesChannelsWorkflow,
  createRegionsWorkflow, createStockLocationsWorkflow, linkSalesChannelsToStockLocationWorkflow,
  createProductsWorkflow, createInventoryLevelsWorkflow, createShippingOptionsWorkflow,
  createOrderFulfillmentWorkflow, createOrderShipmentWorkflow, markOrderFulfillmentAsDeliveredWorkflow,
  createShippingProfilesWorkflow,
} from "@medusajs/medusa/core-flows"
import fs from "fs"

jest.setTimeout(180 * 1000)
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
    it("spikes2", async () => {
      const c = getContainer()
      const events: any[] = []
      const bus: any = c.resolve(Modules.EVENT_BUS)
      for (const n of ["order.placed", "order.fulfillment_created", "shipment.created", "delivery.created", "payment.captured", "order.canceled"]) {
        bus.subscribe(n, async (e: any) => { events.push({ name: e.name, data: e.data }) })
      }
      const query = c.resolve(ContainerRegistrationKeys.QUERY)
      const link = c.resolve(ContainerRegistrationKeys.LINK)
      const fulfillment: any = c.resolve(Modules.FULFILLMENT)

      const { result: [sc] } = await createSalesChannelsWorkflow(c).run({ input: { salesChannelsData: [{ name: "Web" }] } })
      const { result: [key] } = await createApiKeysWorkflow(c).run({ input: { api_keys: [{ title: "pk", type: "publishable", created_by: "" }] } })
      await linkSalesChannelsToApiKeyWorkflow(c).run({ input: { id: key.id, add: [sc.id] } })
      const { result: [region] } = await createRegionsWorkflow(c).run({ input: { regions: [{ name: "VN", currency_code: "vnd", countries: ["vn"], payment_providers: ["pp_system_default"] }] } })
      const { result: [loc] } = await createStockLocationsWorkflow(c).run({ input: { locations: [{ name: "Kho Q.7", address: { city: "HCM", country_code: "VN", address_1: "x" } }] } })
      await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: loc.id }, [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" } })
      await linkSalesChannelsToStockLocationWorkflow(c).run({ input: { id: loc.id, add: [sc.id] } })
      const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] })
      let profileId = profiles[0]?.id
      if (!profileId) {
        profileId = (await createShippingProfilesWorkflow(c).run({ input: { data: [{ name: "Default", type: "default" }] } })).result[0].id
      }
      const fset = await fulfillment.createFulfillmentSets({ name: "Q7", type: "shipping", service_zones: [{ name: "VN", geo_zones: [{ country_code: "vn", type: "country" }] }] })
      await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: loc.id }, [Modules.FULFILLMENT]: { fulfillment_set_id: fset.id } })
      const { result: [so] } = await createShippingOptionsWorkflow(c).run({ input: [{
        name: "Giao tan nha", price_type: "flat", provider_id: "manual_manual", service_zone_id: fset.service_zones[0].id, shipping_profile_id: profileId,
        type: { label: "Giao", description: "d", code: "home" }, prices: [{ currency_code: "vnd", amount: 15000 }],
        rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }, { attribute: "is_return", value: "false", operator: "eq" }],
      }] })
      await createProductsWorkflow(c).run({ input: { products: [{
        title: "Ca chua", handle: "ca-chua", status: "published" as any, shipping_profile_id: profileId,
        sales_channels: [{ id: sc.id }], options: [{ title: "Quy cach", values: ["500g"] }],
        variants: [{ title: "500g", sku: "CC-500", manage_inventory: true, options: { "Quy cach": "500g" }, prices: [{ amount: 25000, currency_code: "vnd" }] }],
      }] } })
      const { data: [v] } = await query.graph({ entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"] })
      await createInventoryLevelsWorkflow(c).run({ input: { inventory_levels: [{ inventory_item_id: v.inventory_items[0].inventory_item_id, location_id: loc.id, stocked_quantity: 10 }] } })
      const h = { headers: { "x-publishable-api-key": key.token } }

      let cartId = ""
      await safe("cart_flow", async () => {
        cartId = (await api.post("/store/carts", { region_id: region.id, sales_channel_id: sc.id, email: "a@b.vn", shipping_address: { first_name: "A", last_name: "B", address_1: "1", city: "HCM", country_code: "vn", postal_code: "700000" }, items: [{ variant_id: v.id, quantity: 2 }] }, h)).data.cart.id
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: so.id }, h)
        const pc = (await api.post("/store/payment-collections", { cart_id: cartId }, h)).data.payment_collection
        await api.post(`/store/payment-collections/${pc.id}/payment-sessions`, { provider_id: "pp_system_default" }, h)
        return { cartId, pcId: pc.id }
      })
      await safe("S8_complete_1", async () => { const r = await api.post(`/store/carts/${cartId}/complete`, {}, h); return { type: r.data.type, order: r.data.order?.id } })
      await safe("S8_complete_2", async () => {
        const r: any = await api.post(`/store/carts/${cartId}/complete`, {}, h).catch((e: any) => ({ status: e.response?.status, data: e.response?.data }))
        return r.data?.type ? { type: r.data.type, order: r.data.order?.id } : r
      })
      await safe("S8_cart_completed_at", async () => (await api.get(`/store/carts/${cartId}?fields=+completed_at`, h).catch((e: any) => ({ data: { err: e.response?.data } }))).data)

      let orderId = ""
      await safe("order_by_cart", async () => {
        const { data } = await query.graph({ entity: "order_cart", fields: ["order_id", "cart_id"], filters: { cart_id: cartId } })
        orderId = (data[0] as any)?.order_id
        return data
      })
      let fulId = ""
      await safe("S7_fulfillment", async () => {
        const { data: [o] } = await query.graph({ entity: "order", fields: ["id", "items.id", "items.detail.quantity"], filters: { id: orderId } })
        const r = await createOrderFulfillmentWorkflow(c).run({ input: { order_id: orderId, items: (o as any).items.map((i: any) => ({ id: i.id, quantity: i.detail.quantity })) } })
        fulId = (r.result as any).id
        return { fulId }
      })
      await safe("S3_lookup_fulfillment_to_order", async () => {
        const a = await query.graph({ entity: "order_fulfillment", fields: ["order_id", "fulfillment_id"], filters: { fulfillment_id: fulId } })
        const b: any = await query.graph({ entity: "fulfillment", fields: ["id", "order.id"], filters: { id: fulId } }).catch((e: any) => ({ err: e.message }))
        return { viaLinkEntity: a.data, viaFulfillmentOrder: b.data ?? b }
      })
      await safe("S7_shipment", async () => {
        const { data: [o] } = await query.graph({ entity: "order", fields: ["id", "items.id", "items.detail.quantity"], filters: { id: orderId } })
        await createOrderShipmentWorkflow(c).run({ input: { order_id: orderId, fulfillment_id: fulId, items: (o as any).items.map((i: any) => ({ id: i.id, quantity: i.detail.quantity })) } })
        return "ok"
      })
      await safe("S7_delivered", async () => { await markOrderFulfillmentAsDeliveredWorkflow(c).run({ input: { orderId, fulfillmentId: fulId } } as any); return "ok" })
      await new Promise((r) => setTimeout(r, 1000))
      log["events"] = events
      await safe("customer_register", async () => {
        const reg = await api.post("/auth/customer/emailpass/register", { email: "kh@b.vn", password: "Passw0rd!" })
        const cust = await api.post("/store/customers", { email: "kh@b.vn", first_name: "K" }, { headers: { ...h.headers, authorization: `Bearer ${reg.data.token}` } })
        const login = await api.post("/auth/customer/emailpass", { email: "kh@b.vn", password: "Passw0rd!" })
        return { cust: cust.data.customer.id, loginHasToken: !!login.data.token }
      })
      save()
    })
  },
})
