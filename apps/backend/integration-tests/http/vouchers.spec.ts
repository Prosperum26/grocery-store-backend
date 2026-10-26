import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { linkCustomersToCustomerGroupWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { seedPromotions } from "../../src/lib/seed/seed-promotions"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"

jest.setTimeout(240 * 1000)

const PASSWORD = "Passw0rd!"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    // Dựng cửa hàng + catalog + mã giảm giá; đăng ký một khách và đăng nhập (verified-apis S7).
    async function setup(email = "khach@example.com") {
      const container = getContainer()
      const store = await bootstrapStore(container)
      await seedCatalog(container, {
        regionId: store.regionId,
        salesChannelId: store.salesChannelId,
        stockLocationId: store.stockLocationId,
      })
      await seedPromotions(container, { regionId: store.regionId })

      const publishable = { "x-publishable-api-key": store.publishableKey }
      const register = await api.post("/auth/customer/emailpass/register", { email, password: PASSWORD })
      await api.post(
        "/store/customers",
        { email, first_name: "Khach" },
        { headers: { ...publishable, authorization: `Bearer ${register.data.token}` } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password: PASSWORD })
      const headers = { headers: { ...publishable, authorization: `Bearer ${login.data.token}` } }
      const [customer] = await graph({ entity: "customer", fields: ["id"], filters: { email } })
      return { container, store, publishable, headers, customerId: customer.id as string }
    }

    const getVouchers = async (headers: any): Promise<any[]> =>
      (await api.get("/store/customers/me/vouchers", headers)).data.vouchers

    // Giỏ của khách đang đăng nhập với `quantity` món đầu catalog, rồi áp mã.
    async function cartWithItems(ctx: Awaited<ReturnType<typeof setup>>, quantity: number) {
      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })
      const { data } = await api.post(
        "/store/carts",
        {
          region_id: ctx.store.regionId,
          sales_channel_id: ctx.store.salesChannelId,
          email: "khach@example.com",
          items: [{ variant_id: variant.id, quantity }],
        },
        ctx.headers
      )
      return data.cart.id as string
    }

    const readCart = async (ctx: Awaited<ReturnType<typeof setup>>, cartId: string) =>
      (await api.get(`/store/carts/${cartId}?fields=+item_subtotal,+discount_total,+total`, ctx.headers)).data.cart

    describe("ví mã giảm giá", () => {
      it("chưa đăng nhập -> 401", async () => {
        const { publishable } = await setup()
        const res = await api.get("/store/customers/me/vouchers", { headers: publishable }).catch((e: any) => e.response)
        expect(res.status).toBe(401)
      })

      it("khách thường: TUOI20 usable, HETHAN5 expired, THANHVIEN15 không usable", async () => {
        const ctx = await setup()
        const vouchers = await getVouchers(ctx.headers)
        const byCode = (code: string) => vouchers.find((v) => v.code === code)

        expect(byCode("TUOI20")).toEqual({
          code: "TUOI20",
          title: expect.any(String),
          description: expect.any(String),
          discountLabel: "Giảm 20.000đ",
          minSubtotal: 150000,
          endsAt: null,
          status: "usable",
        })
        expect(byCode("HETHAN5")).toMatchObject({ status: "expired", endsAt: expect.any(String) })
        expect(byCode("THANHVIEN15")?.status).not.toBe("usable")

        // usable đứng trước expired.
        const order = vouchers.map((v) => v.status)
        expect(order.indexOf("usable")).toBeLessThan(order.indexOf("expired"))
        expect(order.lastIndexOf("usable")).toBeLessThan(order.indexOf("expired"))
      })

      it("thêm khách vào nhóm Thành viên -> THANHVIEN15 usable", async () => {
        const ctx = await setup()
        expect((await getVouchers(ctx.headers)).find((v) => v.code === "THANHVIEN15")?.status).not.toBe("usable")

        const [group] = await graph({ entity: "customer_group", fields: ["id"], filters: { name: "Thành viên" } })
        await linkCustomersToCustomerGroupWorkflow(ctx.container).run({
          input: { id: group.id, add: [ctx.customerId] },
        })

        const voucher = (await getVouchers(ctx.headers)).find((v) => v.code === "THANHVIEN15")
        expect(voucher).toMatchObject({ status: "usable", discountLabel: "Giảm 15.000đ", minSubtotal: null })
      })

      it("seed chạy lại không nhân đôi mã hay nhóm", async () => {
        const ctx = await setup()
        await seedPromotions(ctx.container, { regionId: ctx.store.regionId })
        const codes = (await graph({ entity: "promotion", fields: ["code"] })).map((p) => p.code).sort()
        expect(codes).toEqual(["HETHAN5", "THANHVIEN15", "TUOI20"])
        expect(await graph({ entity: "customer_group", fields: ["id"], filters: { name: "Thành viên" } })).toHaveLength(1)
      })
    })

    describe("áp mã vào giỏ", () => {
      it("TUOI20 giảm đúng 20.000 khi giỏ từ 150.000", async () => {
        const ctx = await setup()
        const cartId = await cartWithItems(ctx, 5) // 5 x 32.000 = 160.000
        const before = await readCart(ctx, cartId)
        expect(Number(before.item_subtotal)).toBeGreaterThanOrEqual(150000)

        await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: ["TUOI20"] }, ctx.headers)
        const after = await readCart(ctx, cartId)
        expect(Number(after.discount_total)).toBe(20000)
        expect(Number(after.total)).toBe(Number(before.total) - 20000)
      })

      it("TUOI20 không giảm khi giỏ dưới 150.000", async () => {
        const ctx = await setup()
        const cartId = await cartWithItems(ctx, 2) // 64.000
        await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: ["TUOI20"] }, ctx.headers)
        expect(Number((await readCart(ctx, cartId)).discount_total)).toBe(0)
      })

      it("THANHVIEN15 chỉ giảm cho thành viên", async () => {
        const ctx = await setup()
        const cartId = await cartWithItems(ctx, 2)
        await api.post(`/store/carts/${cartId}/promotions`, { promo_codes: ["THANHVIEN15"] }, ctx.headers)
        expect(Number((await readCart(ctx, cartId)).discount_total)).toBe(0)

        const [group] = await graph({ entity: "customer_group", fields: ["id"], filters: { name: "Thành viên" } })
        await linkCustomersToCustomerGroupWorkflow(ctx.container).run({
          input: { id: group.id, add: [ctx.customerId] },
        })
        const memberCartId = await cartWithItems(ctx, 2)
        await api.post(`/store/carts/${memberCartId}/promotions`, { promo_codes: ["THANHVIEN15"] }, ctx.headers)
        expect(Number((await readCart(ctx, memberCartId)).discount_total)).toBe(15000)
      })

      it("mã không tồn tại -> 4xx", async () => {
        const ctx = await setup()
        const cartId = await cartWithItems(ctx, 5)
        const res = await api
          .post(`/store/carts/${cartId}/promotions`, { promo_codes: ["KHONGCO"] }, ctx.headers)
          .catch((e: any) => e.response)
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
      })
    })
  },
})
