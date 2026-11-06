import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow, updateInventoryLevelsWorkflow, updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import expireHolds from "../../src/jobs/expire-holds"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"
import { expireHoldsWorkflow } from "../../src/workflows/expire-holds"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const WAIT_MS = 30000 // subscriber chạy bất đồng bộ

// Vòng đời hold (plan hot-stock HS-5): giữ → đặt đơn → CONFIRMED; giữ → bỏ → EXPIRED. Cần container Redis.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]
    const hotStock = () => getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const redis = () => (hotStock() as any).redis

    let cartCount = 0
    async function setup(stocked: number) {
      const container = getContainer()
      const stale = await redis().keys(`${hotStock().prefix}*`)
      if (stale.length) await redis().del(...stale)
      const store = await bootstrapStore(container)
      await seedCatalog(container, { regionId: store.regionId, salesChannelId: store.salesChannelId, stockLocationId: store.stockLocationId })
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
      await updateInventoryLevelsWorkflow(container).run({ input: { updates: [{ ...ref, stocked_quantity: stocked }] } })

      const avail = async () => (await hotStock().available([ref]))[0]
      const held = async () => Number(await redis().get(hotStock().keys.held(ref)))
      const waitForAvail = (expected: number) => waitFor(async () => ((await avail()) === expected ? true : undefined), { timeoutMs: WAIT_MS })
      await waitForAvail(stocked)

      // Giỏ có phí giao và phiên thanh toán hệ thống (hoàn tất được không cần VNPAY).
      const newCart = async (quantity: number) => {
        const { data } = await api.post("/store/carts", {
          region_id: store.regionId, sales_channel_id: store.salesChannelId, email: `khach-${++cartCount}@example.com`,
          shipping_address: { first_name: "An", last_name: "Nguyen", address_1: "1 NVL", city: "HCM", country_code: "vn", postal_code: "700000" },
          items: [{ variant_id: variant.id, quantity }],
        }, headers)
        const cartId = data.cart.id as string
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, headers)
        const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, headers)
        await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, headers)
        return cartId
      }
      const reserve = (cartId: string) => api.post(`/store/carts/${cartId}/reserve`, {}, headers)
      const complete = async (cartId: string) => (await api.post(`/store/carts/${cartId}/complete`, {}, headers)).data.order.id as string
      const holdStatus = async (cartId: string) => (await hotStock().getHold(cartId))?.status ?? null
      const waitForHold = (cartId: string, status: string) =>
        waitFor(async () => ((await holdStatus(cartId)) === status ? true : undefined), { timeoutMs: WAIT_MS })
      return { container, ref, avail, held, waitForAvail, newCart, reserve, complete, holdStatus, waitForHold }
    }

    describe("xác nhận khi có đơn", () => {
      it("giữ rồi đặt đơn: hold CONFIRMED, held về 0, avail = tồn − đơn (không bị trừ hai lần)", async () => {
        const ctx = await setup(10)
        const cartId = await ctx.newCart(3)
        await ctx.reserve(cartId)
        expect([await ctx.avail(), await ctx.held()]).toEqual([7, 3])

        await ctx.complete(cartId)
        await ctx.waitForHold(cartId, "CONFIRMED")
        await ctx.waitForAvail(7)
        // Chờ thêm: subscriber reservation-item.created có thể chạy sau; số cuối vẫn phải là 7, không phải 4.
        await new Promise((resolve) => setTimeout(resolve, 1500))
        expect([await ctx.avail(), await ctx.held()]).toEqual([7, 0])
        const [level] = await graph({ entity: "inventory_level", fields: ["stocked_quantity", "reserved_quantity"], filters: { inventory_item_id: ctx.ref.inventory_item_id } })
        expect([Number(level.stocked_quantity), Number(level.reserved_quantity)]).toEqual([10, 3])
      })

      it("huỷ đơn đã xác nhận: hàng về kho qua reservation bị xoá, hold vẫn CONFIRMED", async () => {
        const ctx = await setup(10)
        const cartId = await ctx.newCart(4)
        await ctx.reserve(cartId)
        const orderId = await ctx.complete(cartId)
        await ctx.waitForHold(cartId, "CONFIRMED")
        await ctx.waitForAvail(6)

        await cancelOrderWorkflow(ctx.container).run({ input: { order_id: orderId } })
        await ctx.waitForAvail(10)
        expect(await ctx.holdStatus(cartId)).toBe("CONFIRMED")
        expect(await ctx.held()).toBe(0)
      })

      it("đặt đơn mà không giữ hàng trước (bỏ qua API-14): không có hold, số vẫn đúng theo Postgres", async () => {
        const ctx = await setup(10)
        const cartId = await ctx.newCart(2)
        await ctx.complete(cartId)
        await ctx.waitForAvail(8)
        expect(await ctx.holdStatus(cartId)).toBeNull()
      })
    })

    describe("hết hạn", () => {
      it("khách bỏ giữa chừng: quá 15 phút thì job trả hàng, hold EXPIRED; giữ lại được", async () => {
        const ctx = await setup(5)
        const cartId = await ctx.newCart(2)
        await ctx.reserve(cartId)
        expect(await ctx.avail()).toBe(3)

        const now = Math.floor(Date.now() / 1000)
        const { result: early } = await expireHoldsWorkflow(ctx.container).run({ input: { now: now + 890 } })
        expect(early).toBe(0)
        expect(await ctx.avail()).toBe(3)

        const { result: late } = await expireHoldsWorkflow(ctx.container).run({ input: { now: now + 901 } })
        expect(late).toBe(1)
        expect([await ctx.avail(), await ctx.held(), await ctx.holdStatus(cartId)]).toEqual([5, 0, "EXPIRED"])

        // Khách quay lại thanh toán: giữ lại trừ tồn thật (lỗi của repo thử đã sửa ở HS-2).
        expect((await ctx.reserve(cartId)).status).toBe(200)
        expect(await ctx.avail()).toBe(3)
      })

      it("job theo lịch (giờ thật) không đụng hold chưa tới hạn và hold đã xác nhận", async () => {
        const ctx = await setup(10)
        const fresh = await ctx.newCart(1)
        await ctx.reserve(fresh)
        const ordered = await ctx.newCart(2)
        await ctx.reserve(ordered)
        await ctx.complete(ordered)
        await ctx.waitForHold(ordered, "CONFIRMED")

        expect(await expireHolds(ctx.container)).toBe(0)
        expect([await ctx.holdStatus(fresh), await ctx.holdStatus(ordered)]).toEqual(["HELD", "CONFIRMED"])
        await ctx.waitForAvail(7)
      })
    })
  },
})
