import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import Redis from "ioredis"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateInventoryLevelsWorkflow, updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const WAIT_MS = 30000 // subscriber đồng bộ tồn kho chạy bất đồng bộ

// API-14 POST /store/carts/:id/reserve (plan hot-stock HS-4). Cần container Redis.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]
    const hotStock = () => getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const redis = () => (hotStock() as any).redis
    const clearRedis = async () => {
      const keys = await redis().keys(`${hotStock().prefix}*`)
      if (keys.length) await redis().del(...keys)
    }

    let cartCount = 0
    async function setup() {
      const container = getContainer()
      await clearRedis()
      const store = await bootstrapStore(container)
      await seedCatalog(container, { regionId: store.regionId, salesChannelId: store.salesChannelId, stockLocationId: store.stockLocationId })
      await updateRegionsWorkflow(container).run({
        input: { selector: { id: store.regionId }, update: { payment_providers: ["pp_vnpay_vnpay", "pp_system_default"] } },
      })
      const variants = await graph({
        entity: "product_variant",
        fields: ["id", "sku", "inventory_items.inventory_item_id"],
        filters: { sku: [CATALOG[0].variants[0].sku, CATALOG[1].variants[0].sku] },
      })
      const bySku = (sku: string) => variants.find((v) => v.sku === sku)
      const A = bySku(CATALOG[0].variants[0].sku)
      const B = bySku(CATALOG[1].variants[0].sku)
      const refOf = (v: any) => ({ location_id: store.stockLocationId, inventory_item_id: v.inventory_items[0].inventory_item_id as string })
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }

      // Đặt tồn rồi chờ subscriber đẩy sang Redis.
      const setStock = async (v: any, stocked_quantity: number) => {
        await updateInventoryLevelsWorkflow(container).run({
          input: { updates: [{ ...refOf(v), stocked_quantity }] },
        })
        await waitFor(async () => ((await hotStock().available([refOf(v)]))[0] === stocked_quantity ? true : undefined), { timeoutMs: WAIT_MS })
      }
      const newCart = async (items: { variant_id: string; quantity: number }[]) => {
        const { data } = await api.post("/store/carts", {
          // Mỗi giỏ một email: Medusa tạo khách vãng lai theo email, tạo đồng thời cùng email thì đụng nhau.
          region_id: store.regionId, sales_channel_id: store.salesChannelId, email: `khach-${++cartCount}@example.com`,
          shipping_address: { first_name: "An", last_name: "Nguyen", address_1: "1 NVL", city: "HCM", country_code: "vn", postal_code: "700000" },
          items,
        }, headers)
        return data.cart.id as string
      }

      const reserve = (cartId: string) => api.post(`/store/carts/${cartId}/reserve`, {}, headers).catch((e: any) => e.response)
      const avail = async (v: any) => (await hotStock().available([refOf(v)]))[0]
      return { container, store, A, B, refOf, headers, setStock, newCart, reserve, avail }
    }

    describe("POST /store/carts/:id/reserve", () => {
      it("đủ hàng: 200, hold HELD hết hạn sau 15 phút, tồn trong Redis giảm", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 10)
        await ctx.setStock(ctx.B, 10)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }, { variant_id: ctx.B.id, quantity: 3 }])
        const before = Date.now()
        const res = await ctx.reserve(cartId)
        expect(res.status).toBe(200)
        expect(res.data.hold).toMatchObject({ cart_id: cartId, status: "HELD" })
        const ttlMs = new Date(res.data.hold.expires_at).getTime() - before
        expect(ttlMs).toBeGreaterThan(895 * 1000)
        expect(ttlMs).toBeLessThanOrEqual(901 * 1000)
        expect([await ctx.avail(ctx.A), await ctx.avail(ctx.B)]).toEqual([8, 7])
      })

      it("thiếu một món (người khác đang giữ): 409 OUT_OF_STOCK chỉ món thiếu, không giữ món nào", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 10)
        await ctx.setStock(ctx.B, 3)
        // Medusa từ chối thêm vào giỏ nhiều hơn tồn Postgres, nên món thiếu trong Redis là do giỏ khác đang giữ.
        const other = await ctx.newCart([{ variant_id: ctx.B.id, quantity: 2 }])
        expect((await ctx.reserve(other)).status).toBe(200)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }, { variant_id: ctx.B.id, quantity: 3 }])
        const res = await ctx.reserve(cartId)
        expect(res.status).toBe(409)
        expect(res.data).toMatchObject({
          code: "OUT_OF_STOCK",
          items: [{ variant_id: ctx.B.id, inventory_item_id: ctx.refOf(ctx.B).inventory_item_id, requested: 3, available: 1 }],
        })
        expect([await ctx.avail(ctx.A), await ctx.avail(ctx.B)]).toEqual([10, 1])
        expect(await hotStock().getHold(cartId)).toBeNull()
        // Giỏ kia trả hàng thì giỏ này giữ được.
        await hotStock().release(other)
        expect((await ctx.reserve(cartId)).status).toBe(200)
        expect([await ctx.avail(ctx.A), await ctx.avail(ctx.B)]).toEqual([8, 0])
      })

      it("bấm hai lần không trừ hai lần; đổi số lượng rồi gọi lại chỉ trừ phần chênh lệch", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 10)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }])
        const [first, second] = await Promise.all([ctx.reserve(cartId), ctx.reserve(cartId)])
        expect([first.status, second.status]).toEqual([200, 200])
        expect(await ctx.avail(ctx.A)).toBe(8)

        const { data } = await api.get(`/store/carts/${cartId}?fields=items.id`, ctx.headers)
        await api.post(`/store/carts/${cartId}/line-items/${data.cart.items[0].id}`, { quantity: 5 }, ctx.headers)
        expect((await ctx.reserve(cartId)).status).toBe(200)
        expect(await ctx.avail(ctx.A)).toBe(5)
      })

      it("hai dòng cùng biến thể (khác cách sơ chế) được gộp thành một món khi giữ", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 10)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }])
        await api.post(`/store/carts/${cartId}/line-items`, { variant_id: ctx.A.id, quantity: 3, metadata: { prep: "Cắt khúc" } }, ctx.headers)
        const { data } = await api.get(`/store/carts/${cartId}?fields=items.id`, ctx.headers)
        expect(data.cart.items).toHaveLength(2)
        expect((await ctx.reserve(cartId)).status).toBe(200)
        expect(await ctx.avail(ctx.A)).toBe(5)
        expect((await hotStock().getHold(cartId))?.lines).toEqual([{ avail_key: hotStock().keys.avail(ctx.refOf(ctx.A)), quantity: 5 }])
      })

      it("Redis trống (khởi động lạnh): tự đặt lại món của giỏ từ Postgres rồi giữ được", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 6)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }])
        await clearRedis()
        expect(await ctx.avail(ctx.A)).toBeNull()
        expect((await ctx.reserve(cartId)).status).toBe(200)
        expect(await ctx.avail(ctx.A)).toBe(4)
      })

      it("giỏ đã hoàn tất: 409 CART_COMPLETED; giỏ lạ 404; giỏ trống 400", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 10)
        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 1 }])
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: ctx.store.shippingOptionId }, ctx.headers)
        const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, ctx.headers)
        await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, ctx.headers)
        await api.post(`/store/carts/${cartId}/complete`, {}, ctx.headers)
        const completed = await ctx.reserve(cartId)
        expect({ status: completed.status, code: completed.data.code }).toEqual({ status: 409, code: "CART_COMPLETED" })

        expect((await ctx.reserve("cart_khong_ton_tai")).status).toBe(404)
        const empty = await ctx.newCart([])
        expect((await ctx.reserve(empty)).status).toBe(400)
      })

      it("20 giỏ cùng giữ món còn 5 qua HTTP: đúng 5 giỏ được 200, còn lại 409", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 5)
        const carts: string[] = []
        for (let i = 0; i < 20; i++) carts.push(await ctx.newCart([{ variant_id: ctx.A.id, quantity: 1 }]))
        const results = await Promise.all(carts.map((cartId) => ctx.reserve(cartId)))
        expect(results.filter((r) => r.status === 200)).toHaveLength(5)
        expect(results.filter((r) => r.status === 409 && r.data.code === "OUT_OF_STOCK")).toHaveLength(15)
        expect(await ctx.avail(ctx.A)).toBe(0)
      })
    })

    describe("GET /store/stock (API-15) và Pub/Sub (HS-8)", () => {
      it("trả số đã trừ phần giỏ khác đang giữ, kèm inventory_item_id để subscribe; biến thể lạ bị bỏ qua", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 5)
        await ctx.setStock(ctx.B, 8)
        const other = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }])
        await ctx.reserve(other)

        const { data } = await api.get(`/store/stock?variant_ids=${ctx.A.id},${ctx.B.id},variant_khong_co,${ctx.A.id}`, ctx.headers)
        expect(data.stock).toEqual(
          expect.arrayContaining([
            { variant_id: ctx.A.id, inventory_item_id: ctx.refOf(ctx.A).inventory_item_id, location_id: ctx.store.stockLocationId, available: 3, held_by_cart: 0 },
            { variant_id: ctx.B.id, inventory_item_id: ctx.refOf(ctx.B).inventory_item_id, location_id: ctx.store.stockLocationId, available: 8, held_by_cart: 0 },
          ])
        )
        expect(data.stock).toHaveLength(2)
      })

      it("RB-2: có cart_id thì cộng lại phần chính giỏ đó đang giữ; hold hết hạn thì thôi", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 5)
        const mine = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 2 }])
        await ctx.reserve(mine)

        const anyone = (await api.get(`/store/stock?variant_ids=${ctx.A.id}`, ctx.headers)).data.stock[0]
        expect([anyone.available, anyone.held_by_cart]).toEqual([3, 0])
        const own = (await api.get(`/store/stock?variant_ids=${ctx.A.id}&cart_id=${mine}`, ctx.headers)).data.stock[0]
        expect([own.available, own.held_by_cart]).toEqual([5, 2])

        await hotStock().expireDue({ now: Math.floor(Date.now() / 1000) + 901 })
        const expired = (await api.get(`/store/stock?variant_ids=${ctx.A.id}&cart_id=${mine}`, ctx.headers)).data.stock[0]
        expect([expired.available, expired.held_by_cart]).toEqual([5, 0])
      })

      it("Redis trống: tự đặt lại từ Postgres; thiếu tham số hoặc quá 100 id thì 400", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 6)
        await clearRedis()
        const { data } = await api.get(`/store/stock?variant_ids=${ctx.A.id}`, ctx.headers)
        expect(data.stock[0].available).toBe(6)

        expect((await api.get("/store/stock", ctx.headers).catch((e: any) => e.response)).status).toBe(400)
        const many = Array.from({ length: 101 }, (_, i) => `variant_${i}`).join(",")
        expect((await api.get(`/store/stock?variant_ids=${many}`, ctx.headers).catch((e: any) => e.response)).status).toBe(400)
      })

      it("giữ hàng qua API-14 thì phát số mới lên kênh cho gateway", async () => {
        const ctx = await setup()
        await ctx.setStock(ctx.A, 4)
        const sub = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
        const messages: any[] = []
        sub.on("message", (_channel, message) => messages.push(JSON.parse(message)))
        await sub.subscribe(hotStock().channel)

        const cartId = await ctx.newCart([{ variant_id: ctx.A.id, quantity: 3 }])
        expect((await ctx.reserve(cartId)).status).toBe(200)
        await waitFor(async () => (messages.length ? true : undefined), { timeoutMs: 5000 })
        await sub.quit()
        expect(messages).toContainEqual({ location_id: ctx.store.stockLocationId, inventory_item_id: ctx.refOf(ctx.A).inventory_item_id, available: 1 })
      })
    })
  },
})
