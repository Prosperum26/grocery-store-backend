import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow, deleteInventoryLevelsWorkflow, updateInventoryLevelsWorkflow, updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import reconcileHotStock from "../../src/jobs/reconcile-hot-stock"
import { stockEventTarget } from "../../src/lib/inventory/stock-event"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"
import rebuildHotStock from "../../src/scripts/rebuild-hot-stock"
import { syncHotStockWorkflow } from "../../src/workflows/sync-hot-stock"
import { waitFor } from "./_helpers"

jest.setTimeout(240 * 1000)

const WAIT_MS = 30000 // subscriber chạy bất đồng bộ

// Cần container Redis (README: com4fud-redis). Khi NODE_ENV=test, medusa-config đặt tiền tố c4f-test: để không đụng key của DB dev.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]
    const hotStock = () => getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)

    async function setup() {
      const container = getContainer()
      // Xoá key test của lần chạy trước: DB tạo mới mỗi test nhưng Redis thì không.
      const redis = (hotStock() as any).redis
      const stale = await redis.keys(`${hotStock().prefix}*`)
      if (stale.length) await redis.del(...stale)

      const store = await bootstrapStore(container)
      await seedCatalog(container, {
        regionId: store.regionId,
        salesChannelId: store.salesChannelId,
        stockLocationId: store.stockLocationId,
      })
      await updateRegionsWorkflow(container).run({
        input: { selector: { id: store.regionId }, update: { payment_providers: ["pp_vnpay_vnpay", "pp_system_default"] } },
      })
      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })
      const ref = { location_id: store.stockLocationId, inventory_item_id: variant.inventory_items[0].inventory_item_id as string }
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
      return { container, store, variant, ref, headers }
    }

    const availOf = async (ref: { location_id: string; inventory_item_id: string }) => (await hotStock().available([ref]))[0]
    const waitForAvail = (ref: { location_id: string; inventory_item_id: string }, expected: number) =>
      waitFor(async () => ((await availOf(ref)) === expected ? true : undefined), { timeoutMs: WAIT_MS })
    const setStocked = (ctx: Awaited<ReturnType<typeof setup>>, stocked_quantity: number) =>
      updateInventoryLevelsWorkflow(ctx.container).run({
        input: { updates: [{ inventory_item_id: ctx.ref.inventory_item_id, location_id: ctx.ref.location_id, stocked_quantity }] },
      })

    // Đơn thật qua giỏ, thanh toán bằng provider hệ thống: hoàn tất giỏ tạo reservation.
    async function placeOrder(ctx: Awaited<ReturnType<typeof setup>>, quantity: number): Promise<string> {
      const { data } = await api.post("/store/carts", {
        region_id: ctx.store.regionId, sales_channel_id: ctx.store.salesChannelId, email: "khach@example.com",
        shipping_address: { first_name: "An", last_name: "Nguyen", address_1: "1 NVL", city: "HCM", country_code: "vn", postal_code: "700000" },
        items: [{ variant_id: ctx.variant.id, quantity }],
      }, ctx.headers)
      const cartId = data.cart.id
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: ctx.store.shippingOptionId }, ctx.headers)
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, ctx.headers)
      await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, ctx.headers)
      const done = await api.post(`/store/carts/${cartId}/complete`, {}, ctx.headers)
      return done.data.order.id
    }

    describe("hot-stock module", () => {
      it("đã nạp, có kết nối Redis và đọc đúng options", async () => {
        expect(await hotStock().ping()).toBe("PONG")
        expect(hotStock().prefix).toBe("c4f-test:")
        expect(hotStock().holdTtlSeconds).toBe(900)
      })
    })

    describe("bản sao tồn kho (HS-3)", () => {
      it("seed tạo inventory level thì subscriber đẩy tồn sang Redis; dựng lại toàn bộ không lệch món nào", async () => {
        const ctx = await setup()
        const [level] = await graph({ entity: "inventory_level", fields: ["stocked_quantity"], filters: { inventory_item_id: ctx.ref.inventory_item_id } })
        await waitForAvail(ctx.ref, Number(level.stocked_quantity))

        const levels = await graph({ entity: "inventory_level", fields: ["id"] })
        const { result } = await syncHotStockWorkflow(ctx.container).run({ input: {} })
        expect(result).toEqual({ synced: levels.length, created: 0, changed: 0 })
      })

      it("admin sửa tồn: avail = tồn mới − phần đang giữ", async () => {
        const ctx = await setup()
        await setStocked(ctx, 20)
        await waitForAvail(ctx.ref, 20)
        await hotStock().reserve({ cart_id: "cart_giu_thu", lines: [{ ...ctx.ref, quantity: 3 }] })
        expect(await availOf(ctx.ref)).toBe(17)
        await setStocked(ctx, 50)
        await waitForAvail(ctx.ref, 47)
      })

      it("đặt đơn tạo reservation thì avail giảm; huỷ đơn xoá reservation thì avail tăng lại", async () => {
        const ctx = await setup()
        await setStocked(ctx, 30)
        await waitForAvail(ctx.ref, 30)
        const orderId = await placeOrder(ctx, 4)
        await waitForAvail(ctx.ref, 26)
        await cancelOrderWorkflow(ctx.container).run({ input: { order_id: orderId } })
        await waitForAvail(ctx.ref, 30)
      })

      it("xoá inventory level (món không còn ở kho): avail về 0 trừ phần đang giữ", async () => {
        const ctx = await setup()
        await setStocked(ctx, 0)
        await waitForAvail(ctx.ref, 0)
        const [level] = await graph({ entity: "inventory_level", fields: ["id"], filters: { inventory_item_id: ctx.ref.inventory_item_id } })
        // Đặt key thành số khác 0: subscriber phải đọc được level đã xoá (withDeleted) mới đưa về 0.
        await (hotStock() as any).redis.set(hotStock().keys.avail(ctx.ref), 5)
        await deleteInventoryLevelsWorkflow(ctx.container).run({
          input: { inventory_item_id: [ctx.ref.inventory_item_id], location_id: [ctx.ref.location_id] },
        })
        await waitForAvail(ctx.ref, 0)
        const query = ctx.container.resolve(ContainerRegistrationKeys.QUERY)
        expect(await stockEventTarget(query, "inventory-level.deleted", level.id)).toEqual({ inventory_item_ids: [], removed: [ctx.ref] })
      })

      it("job đối soát sửa key bị lệch và đếm số món lệch", async () => {
        const ctx = await setup()
        await setStocked(ctx, 12)
        await waitForAvail(ctx.ref, 12)
        await (hotStock() as any).redis.set(hotStock().keys.avail(ctx.ref), 999)
        const result = await reconcileHotStock(ctx.container)
        expect(result.changed).toBe(1)
        expect(await availOf(ctx.ref)).toBe(12)
      })

      it("Redis mất hết key: script dựng lại đưa mọi món về đúng", async () => {
        const ctx = await setup()
        await setStocked(ctx, 8)
        await waitForAvail(ctx.ref, 8)
        const redis = (hotStock() as any).redis
        await redis.del(...(await redis.keys(`${hotStock().prefix}stock:*`)))
        expect(await availOf(ctx.ref)).toBeNull()
        await rebuildHotStock({ container: ctx.container } as any)
        expect(await availOf(ctx.ref)).toBe(8)
      })
    })
  },
})
