import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"
import { signParams } from "../../src/modules/vnpay/lib/signature"
import { findStuckPaymentsWorkflow } from "../../src/workflows/find-stuck-payments"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const SECRET = process.env.VNPAY_HASH_SECRET as string
const TMN_CODE = process.env.VNPAY_TMN_CODE as string
const WAIT_MS = 30000

// IPN của VNPAY và cổng giữ hàng (plan hot-stock HS-6, D4). VNPAY chỉ giả lập: IPN ký bằng khóa thử, API hoàn
// tiền được thay bằng jest.spyOn(fetch) (test chạy cùng tiến trình với Medusa).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]
    const hotStock = () => getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const redis = () => (hotStock() as any).redis

    let fetchSpy: jest.SpyInstance
    // Trả lời của API hoàn tiền: mặc định VNPAY nhận lệnh hoàn.
    const refundReplies = (body: Record<string, string>) =>
      fetchSpy.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }))
    beforeEach(() => {
      fetchSpy = jest.spyOn(global, "fetch")
      refundReplies({ vnp_ResponseCode: "00", vnp_TransactionStatus: "00", vnp_TransactionNo: "REFUND1" })
    })
    afterEach(() => fetchSpy.mockRestore())
    const refundCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes("merchant_webapi")).length

    let cartCount = 0
    async function setup(stocked: number) {
      const container = getContainer()
      const stale = await redis().keys(`${hotStock().prefix}*`)
      if (stale.length) await redis().del(...stale)
      const store = await bootstrapStore(container)
      await seedCatalog(container, { regionId: store.regionId, salesChannelId: store.salesChannelId, stockLocationId: store.stockLocationId })
      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })
      const ref = { location_id: store.stockLocationId, inventory_item_id: variant.inventory_items[0].inventory_item_id as string }
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
      await updateInventoryLevelsWorkflow(container).run({ input: { updates: [{ ...ref, stocked_quantity: stocked }] } })
      const avail = async () => (await hotStock().available([ref]))[0]
      const waitForAvail = (n: number) => waitFor(async () => ((await avail()) === n ? true : undefined), { timeoutMs: WAIT_MS })
      await waitForAvail(stocked)

      // Giỏ đến bước VNPAY: phí giao, phiên pp_vnpay_vnpay (payment_url, txn_ref).
      async function checkout(quantity: number) {
        const { data } = await api.post("/store/carts", {
          region_id: store.regionId, sales_channel_id: store.salesChannelId, email: `khach-${++cartCount}@example.com`,
          shipping_address: { first_name: "An", last_name: "Nguyen", address_1: "1 NVL", city: "HCM", country_code: "vn", postal_code: "700000" },
          items: [{ variant_id: variant.id, quantity }],
        }, headers)
        const cartId = data.cart.id as string
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, headers)
        const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, headers)
        const { data: s } = await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: "pp_vnpay_vnpay" }, headers)
        const session = s.payment_collection.payment_sessions[0]
        return { cartId, sessionId: session.id as string, txnRef: session.data.txn_ref as string, amountVnd: Number(session.amount) }
      }
      const reserve = (cartId: string) => api.post(`/store/carts/${cartId}/reserve`, {}, headers).catch((e: any) => e.response)
      // IPN như VNPAY gửi, ký bằng khóa thử.
      const ipn = (c: { txnRef: string; amountVnd: number }, responseCode = "00") => {
        const params: Record<string, string> = {
          vnp_TmnCode: TMN_CODE, vnp_Amount: String(c.amountVnd * 100), vnp_BankCode: "NCB", vnp_BankTranNo: "VNP1",
          vnp_CardType: "ATM", vnp_OrderInfo: "Thanh toan don hang", vnp_PayDate: "20261104090000",
          vnp_ResponseCode: responseCode, vnp_TransactionNo: "14000001", vnp_TransactionStatus: responseCode, vnp_TxnRef: c.txnRef,
        }
        return api.get("/hooks/vnpay/ipn", { params: { ...params, vnp_SecureHashType: "HmacSHA512", vnp_SecureHash: signParams(params, SECRET) } })
      }
      const orderOf = async (cartId: string) => (await graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } }))[0]?.order_id
      const waitForOrder = (cartId: string) => waitFor(async () => orderOf(cartId), { timeoutMs: WAIT_MS })
      const cartMeta = async (cartId: string) => ((await graph({ entity: "cart", fields: ["metadata", "completed_at"], filters: { id: cartId } }))[0]) as any
      const holdStatus = async (cartId: string) => (await hotStock().getHold(cartId))?.status ?? null
      const expireAll = () => hotStock().expireDue({ now: Math.floor(Date.now() / 1000) + 901 })
      // Khách thanh toán lại trên cùng giỏ: phiên VNPAY mới (txn_ref mới), phiên cũ bị Medusa xoá.
      const retry = async (cartId: string) => {
        const { data } = await api.get(`/store/carts/${cartId}?fields=+payment_collection.id`, headers)
        const { data: s } = await api.post(`/store/payment-collections/${data.cart.payment_collection.id}/payment-sessions`, { provider_id: "pp_vnpay_vnpay" }, headers)
        const session = s.payment_collection.payment_sessions[0]
        return { cartId, sessionId: session.id as string, txnRef: session.data.txn_ref as string, amountVnd: Number(session.amount) }
      }
      const setStock = (n: number) => updateInventoryLevelsWorkflow(container).run({ input: { updates: [{ ...ref, stocked_quantity: n }] } })
      return { container, headers, avail, waitForAvail, checkout, reserve, ipn, orderOf, waitForOrder, cartMeta, holdStatus, expireAll, setStock, retry }
    }

    describe("IPN và hold", () => {
      it("thanh toán thất bại (24): trả hàng ngay, không tạo đơn", async () => {
        const ctx = await setup(5)
        const c = await ctx.checkout(2)
        await ctx.reserve(c.cartId)
        expect(await ctx.avail()).toBe(3)
        expect((await ctx.ipn(c, "24")).data.RspCode).toBe("00")
        expect(await ctx.holdStatus(c.cartId)).toBe("RELEASED")
        expect(await ctx.avail()).toBe(5)
        expect(await ctx.orderOf(c.cartId)).toBeUndefined()
      })

      it("hold còn HELD: tạo đơn, hold CONFIRMED, không gọi hoàn tiền", async () => {
        const ctx = await setup(5)
        const c = await ctx.checkout(2)
        await ctx.reserve(c.cartId)
        expect((await ctx.ipn(c)).data.RspCode).toBe("00")
        await ctx.waitForOrder(c.cartId)
        await waitFor(async () => ((await ctx.holdStatus(c.cartId)) === "CONFIRMED" ? true : undefined), { timeoutMs: WAIT_MS })
        await ctx.waitForAvail(3)
        expect(refundCalls()).toBe(0)
      })

      it("hold đã hết hạn nhưng còn hàng: giữ lại rồi tạo đơn bình thường", async () => {
        const ctx = await setup(5)
        const c = await ctx.checkout(2)
        await ctx.reserve(c.cartId)
        expect(await ctx.expireAll()).toBe(1)
        expect(await ctx.avail()).toBe(5)
        expect((await ctx.ipn(c)).data.RspCode).toBe("00")
        await ctx.waitForOrder(c.cartId)
        await waitFor(async () => ((await ctx.holdStatus(c.cartId)) === "CONFIRMED" ? true : undefined), { timeoutMs: WAIT_MS })
        await ctx.waitForAvail(3)
        expect(refundCalls()).toBe(0)
      })

      it("hold hết hạn và giỏ khác đã giữ mất món cuối: hoàn tiền, không tạo đơn, hold của giỏ kia nguyên vẹn", async () => {
        const ctx = await setup(1)
        const a = await ctx.checkout(1)
        await ctx.reserve(a.cartId)
        await ctx.expireAll()
        // Trong lúc chờ IPN của A, B giữ được món cuối.
        const b = await ctx.checkout(1)
        expect((await ctx.reserve(b.cartId)).status).toBe(200)

        expect((await ctx.ipn(a)).data.RspCode).toBe("00")
        const meta = await ctx.cartMeta(a.cartId)
        expect(meta.completed_at).toBeNull()
        expect(meta.metadata.stock_failed).toMatchObject({ refund: "refunded", vnp_transaction_no: "14000001", items: [{ requested: 1, available: 0 }] })
        expect(refundCalls()).toBe(1)
        expect(await ctx.holdStatus(b.cartId)).toBe("HELD")
        expect(await ctx.avail()).toBe(0)

        // Phiên không có dấu paid: gọi complete không lấy được đơn; IPN gửi lại thì trả 02, không hoàn lần hai.
        const completed = await api.post(`/store/carts/${a.cartId}/complete`, {}, ctx.headers).catch((e: any) => e.response)
        expect(completed.data.type).not.toBe("order")
        expect((await ctx.ipn(a)).data.RspCode).toBe("02")
        expect(refundCalls()).toBe(1)
        expect(await ctx.orderOf(a.cartId)).toBeUndefined()
      })

      it("RB-1: bị hoàn tiền rồi thanh toán lại trên cùng giỏ khi đã có hàng: có đơn, không bị coi là IPN lặp", async () => {
        const ctx = await setup(1)
        const a = await ctx.checkout(1)
        const b = await ctx.checkout(1)
        await ctx.reserve(b.cartId)
        expect((await ctx.ipn(a)).data.RspCode).toBe("00")
        expect((await ctx.cartMeta(a.cartId)).metadata.stock_failed).toMatchObject({ refund: "refunded", txn_ref: a.txnRef })

        // B thanh toán lỗi, hàng về kho; A thử lại với phiên mới.
        await ctx.ipn(b, "24")
        const a2 = await ctx.retry(a.cartId)
        expect(a2.txnRef).not.toBe(a.txnRef)
        expect((await ctx.reserve(a.cartId)).status).toBe(200)
        expect((await ctx.ipn(a2)).data.RspCode).toBe("00")
        await ctx.waitForOrder(a.cartId)
        expect(refundCalls()).toBe(1)
      })

      it("RB-1: thanh toán lại khi vẫn hết hàng: hoàn lần hai, stock_failed ghi giao dịch mới; IPN lặp của giao dịch mới trả 02", async () => {
        const ctx = await setup(1)
        const a = await ctx.checkout(1)
        const b = await ctx.checkout(1)
        await ctx.reserve(b.cartId)
        await ctx.ipn(a)
        const a2 = await ctx.retry(a.cartId)
        expect((await ctx.ipn(a2)).data.RspCode).toBe("00")
        expect(refundCalls()).toBe(2)
        expect((await ctx.cartMeta(a.cartId)).metadata.stock_failed).toMatchObject({ refund: "refunded", txn_ref: a2.txnRef })
        expect((await ctx.ipn(a2)).data.RspCode).toBe("02")
        expect(refundCalls()).toBe(2)
        expect(await ctx.orderOf(a.cartId)).toBeUndefined()
      })

      it("hai IPN cùng lúc cho giỏ hết hàng: chỉ hoàn tiền một lần", async () => {
        const ctx = await setup(1)
        const a = await ctx.checkout(1)
        const b = await ctx.checkout(1)
        await ctx.reserve(b.cartId)
        const codes = (await Promise.all([ctx.ipn(a), ctx.ipn(a)])).map((r) => r.data.RspCode).sort()
        expect(codes).toEqual(["00", "02"])
        expect(refundCalls()).toBe(1)
      })

      it("hoàn tiền bị VNPAY từ chối: ghi refund failed để Admin xử lý, vẫn không tạo đơn", async () => {
        const ctx = await setup(1)
        refundReplies({ vnp_ResponseCode: "99", vnp_Message: "Unknown error" })
        const a = await ctx.checkout(1)
        const b = await ctx.checkout(1)
        await ctx.reserve(b.cartId)
        expect((await ctx.ipn(a)).data.RspCode).toBe("00")
        const meta = await ctx.cartMeta(a.cartId)
        expect(meta.metadata.stock_failed).toMatchObject({ refund: "failed", refund_error: "VNPAY code 99: Unknown error" })
        expect(await ctx.orderOf(a.cartId)).toBeUndefined()
      })
    })

    describe("R2: tiền đã thu, hoàn tất giỏ lỗi, hoàn tiền lỗi", () => {
      it("job đối soát đánh dấu giỏ payment_stuck; đơn bình thường không bị đánh dấu", async () => {
        const ctx = await setup(5)
        refundReplies({ vnp_ResponseCode: "99", vnp_Message: "Unknown error" })

        // Đơn bình thường.
        const ok = await ctx.checkout(1)
        await ctx.reserve(ok.cartId)
        await ctx.ipn(ok)
        await ctx.waitForOrder(ok.cartId)

        // Giỏ giữ 2 món rồi admin giảm tồn Postgres xuống 1: hold vẫn HELD nên IPN cho đi tiếp,
        // Medusa thu tiền rồi hoàn tất giỏ lỗi "Not enough stock", tự hoàn tiền nhưng VNPAY từ chối.
        const stuck = await ctx.checkout(2)
        await ctx.reserve(stuck.cartId)
        await ctx.setStock(2)
        expect((await ctx.ipn(stuck)).data.RspCode).toBe("00")
        await waitFor(
          async () => ((await graph({ entity: "payment", fields: ["id"], filters: { captured_at: { $ne: null } } })).length === 2 ? true : undefined),
          { timeoutMs: WAIT_MS }
        )
        await new Promise((resolve) => setTimeout(resolve, 2000))
        expect(await ctx.orderOf(stuck.cartId)).toBeUndefined()

        const { result } = await findStuckPaymentsWorkflow(ctx.container).run({ input: { min_age_seconds: 0 } })
        expect(result.marked).toEqual([stuck.cartId])
        expect((await ctx.cartMeta(stuck.cartId)).metadata.payment_stuck).toMatchObject({ amount: stuck.amountVnd })
        expect((await ctx.cartMeta(ok.cartId)).metadata?.payment_stuck).toBeUndefined()

        // Chạy lại không đánh dấu lần hai.
        const { result: again } = await findStuckPaymentsWorkflow(ctx.container).run({ input: { min_age_seconds: 0 } })
        expect(again.marked).toEqual([])
      })
    })
  },
})
