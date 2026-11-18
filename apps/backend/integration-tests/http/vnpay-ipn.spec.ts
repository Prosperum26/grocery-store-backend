import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { signParams } from "../../src/modules/vnpay/lib/signature"
import { buildTxnRef } from "../../src/modules/vnpay/lib/txn-ref"
import { waitFor } from "./_helpers"

jest.setTimeout(240 * 1000)

const SECRET = process.env.VNPAY_HASH_SECRET as string
const TMN_CODE = process.env.VNPAY_TMN_CODE as string
const WAIT_MS = 30000 // subscriber xử lý IPN bất đồng bộ

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    // Dựng cửa hàng, giỏ có hàng + phí giao, và phiên thanh toán VNPAY.
    async function setup() {
      const container = getContainer()
      const store = await bootstrapStore(container)
      await seedCatalog(container, {
        regionId: store.regionId,
        salesChannelId: store.salesChannelId,
        stockLocationId: store.stockLocationId,
      })
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })

      const { data: created } = await api.post(
        "/store/carts",
        {
          region_id: store.regionId,
          sales_channel_id: store.salesChannelId,
          email: "khach@example.com",
          shipping_address: {
            first_name: "An", last_name: "Nguyen", address_1: "1 Nguyen Van Linh", city: "HCM",
            country_code: "vn", postal_code: "700000",
          },
          items: [{ variant_id: variant.id, quantity: 2 }],
        },
        headers
      )
      const cartId: string = created.cart.id
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, headers)
      const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, headers)
      const { data: withSession } = await api.post(
        `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
        { provider_id: "pp_vnpay_vnpay" },
        headers
      )
      const session = withSession.payment_collection.payment_sessions[0]
      return {
        container, headers, cartId,
        sessionId: session.id as string,
        amountVnd: Number(session.amount),
        txnRef: session.data.txn_ref as string,
        paymentUrl: session.data.payment_url as string,
      }
    }

    // Query IPN như VNPAY gửi, ký bằng secret test.
    function ipn(txnRef: string, amountVnd: number, overrides: Record<string, string> = {}) {
      const params: Record<string, string> = {
        vnp_TmnCode: TMN_CODE,
        vnp_Amount: String(amountVnd * 100),
        vnp_BankCode: "NCB",
        vnp_BankTranNo: "VNP14000001",
        vnp_CardType: "ATM",
        vnp_OrderInfo: "Thanh toan don hang",
        vnp_PayDate: "20261026233500",
        vnp_ResponseCode: "00",
        vnp_TransactionNo: "14000001",
        vnp_TransactionStatus: "00",
        vnp_TxnRef: txnRef,
        ...overrides,
      }
      return { ...params, vnp_SecureHashType: "HmacSHA512", vnp_SecureHash: signParams(params, SECRET) }
    }

    const callIpn = (query: Record<string, string>) => api.get("/hooks/vnpay/ipn", { params: query })

    // Chờ tới khi đơn của giỏ xuất hiện (payment capture trước, hoàn tất giỏ sau trong cùng workflow).
    const waitForOrder = (cartId: string) =>
      waitFor(
        async () => {
          const rows = await graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
          return rows.length ? rows[0] : undefined
        },
        { timeoutMs: WAIT_MS }
      )

    const orders = () => graph({ entity: "order", fields: ["id"] })
    const payments = () => graph({ entity: "payment", fields: ["id", "amount", "captured_at"] })

    describe("VNPAY IPN", () => {
      it("phiên thanh toán có payment_url ký đúng và số tiền ×100", async () => {
        const { amountVnd, paymentUrl } = await setup()
        const params = Object.fromEntries(new URL(paymentUrl).searchParams)
        expect(params.vnp_Amount).toBe(String(amountVnd * 100))
        expect(params.vnp_TmnCode).toBe(TMN_CODE)
        expect(params.vnp_SecureHash).toBe(signParams(params, SECRET))
      })

      it("chữ ký sai -> 97", async () => {
        const { txnRef, amountVnd } = await setup()
        const res = await callIpn({ ...ipn(txnRef, amountVnd), vnp_SecureHash: "0".repeat(128) })
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ RspCode: "97" })
      })

      it("txn_ref không có phiên -> 01", async () => {
        const { amountVnd } = await setup()
        const missing = buildTxnRef("payses_01ZZZZZZZZZZZZZZZZZZZZZZZZ", 1)
        for (const ref of [missing, "khong-hop-le"]) {
          const res = await callIpn(ipn(ref, amountVnd))
          expect({ ref, status: res.status, code: res.data.RspCode }).toEqual({ ref, status: 200, code: "01" })
        }
      })

      it("sai số tiền -> 04 và không tạo đơn", async () => {
        const { txnRef, amountVnd, cartId, headers } = await setup()
        const res = await callIpn(ipn(txnRef, amountVnd + 1000))
        expect(res.data).toMatchObject({ RspCode: "04" })
        expect(await orders()).toHaveLength(0)
        const cart = (await api.get(`/store/carts/${cartId}?fields=+completed_at`, headers)).data.cart
        expect(cart.completed_at).toBeNull()
      })

      it("hợp lệ -> 00, giỏ hoàn tất, đúng một đơn và một payment captured", async () => {
        const { txnRef, amountVnd, cartId } = await setup()
        const res = await callIpn(ipn(txnRef, amountVnd))
        expect(res.status).toBe(200)
        expect(res.data).toMatchObject({ RspCode: "00" })

        // Subscriber xử lý bất đồng bộ: chờ tới khi đơn xuất hiện.
        const link = await waitForOrder(cartId)
        expect(link.order_id).toBeTruthy()
        expect(await orders()).toHaveLength(1)

        const paid = await waitFor(
          async () => {
            const rows = await payments()
            return rows.length && rows[0].captured_at ? rows : undefined
          },
          { timeoutMs: WAIT_MS }
        )
        expect(paid).toHaveLength(1)
        expect(Number(paid[0].amount)).toBe(amountVnd)
      })

      it("gọi lại cùng tham số sau khi đã xử lý -> 02, vẫn một đơn và một payment", async () => {
        const { txnRef, amountVnd, cartId } = await setup()
        const query = ipn(txnRef, amountVnd)

        expect((await callIpn(query)).data).toMatchObject({ RspCode: "00" })
        await waitForOrder(cartId)

        // VNPAY thử lại IPN: nhận 02 và không tạo thêm gì.
        const again = await callIpn(query)
        expect(again.status).toBe(200)
        expect(again.data).toMatchObject({ RspCode: "02" })
        expect(await orders()).toHaveLength(1)
        expect(await payments()).toHaveLength(1)
        const cart = await graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
        expect(cart).toHaveLength(1)
      })

      it("hai IPN đến cùng lúc (chưa xử lý xong) vẫn chỉ một đơn và một payment", async () => {
        const { txnRef, amountVnd, cartId } = await setup()
        const query = ipn(txnRef, amountVnd)

        const [first, second] = await Promise.all([callIpn(query), callIpn(query)])
        expect([first.data.RspCode, second.data.RspCode].every((c) => c === "00" || c === "02")).toBe(true)

        await waitForOrder(cartId)
        // Chờ thêm để event thừa (nếu có) xử lý xong rồi mới đếm.
        await new Promise((resolve) => setTimeout(resolve, 3000))
        expect(await orders()).toHaveLength(1)
        expect(await payments()).toHaveLength(1)
      })

      it("khách huỷ (24) -> 00 nhưng không tạo đơn; trả thành công sau đó vẫn tạo đúng một đơn", async () => {
        const { txnRef, amountVnd, cartId } = await setup()
        const cancelled = await callIpn(ipn(txnRef, amountVnd, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))
        expect(cancelled.data).toMatchObject({ RspCode: "00" })
        expect(await orders()).toHaveLength(0)

        expect((await callIpn(ipn(txnRef, amountVnd))).data).toMatchObject({ RspCode: "00" })
        await waitForOrder(cartId)
        expect(await orders()).toHaveLength(1)
      })

      it("complete giỏ khi chưa thanh toán không tạo đơn", async () => {
        const { cartId, headers } = await setup()
        const res = await api.post(`/store/carts/${cartId}/complete`, {}, headers).catch((e: any) => e.response)
        expect(res.data.type === "order").toBe(false)
        expect(await orders()).toHaveLength(0)
      })

      it("provider trong event là vnpay_vnpay (module tự thêm tiền tố pp_)", async () => {
        const { txnRef, amountVnd, container } = await setup()
        const paymentModule = container.resolve(Modules.PAYMENT) as any
        const payload = { data: ipn(txnRef, amountVnd), rawData: "", headers: {} }

        const ok = await paymentModule.getWebhookActionAndData({ provider: "vnpay_vnpay", payload })
        expect(ok.action).toBe("captured")
        await expect(
          paymentModule.getWebhookActionAndData({ provider: "pp_vnpay_vnpay", payload })
        ).rejects.toThrow()
      })
    })

    describe("GET /store/vnpay/verify-return", () => {
      it("chỉ kiểm chữ ký và ResponseCode, không đổi trạng thái", async () => {
        const { txnRef, amountVnd, headers } = await setup()
        const verify = async (query: Record<string, string>) =>
          (await api.get("/store/vnpay/verify-return", { ...headers, params: query })).data

        expect(await verify(ipn(txnRef, amountVnd))).toEqual({ valid: true, success: true })
        expect(
          await verify(ipn(txnRef, amountVnd, { vnp_ResponseCode: "24", vnp_TransactionStatus: "02" }))
        ).toEqual({ valid: true, success: false })
        expect(await verify({ ...ipn(txnRef, amountVnd), vnp_SecureHash: "0".repeat(128) })).toEqual({
          valid: false,
          success: false,
        })

        // Return URL không được cập nhật trạng thái (V14): không có đơn nào.
        expect(await orders()).toHaveLength(0)
      })
    })
  },
})
