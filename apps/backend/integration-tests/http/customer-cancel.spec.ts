import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  capturePaymentWorkflow,
  createOrderFulfillmentWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { SystemPaymentProvider } from "@medusajs/payment/dist/providers/system"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { createAdminHeaders } from "./_admin"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const WAIT_MS = 30000 // subscriber chạy bất đồng bộ
const PASSWORD = "Passw0rd!"
const QUANTITY = 2

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    const orderMetadata = async (orderId: string) =>
      ((await graph({ entity: "order", fields: ["id", "metadata"], filters: { id: orderId } }))[0].metadata ?? {}) as any

    const orderStatus = async (orderId: string) =>
      (await graph({ entity: "order", fields: ["id", "status"], filters: { id: orderId } }))[0].status as string

    const waitForStage = (orderId: string, stage: string) =>
      waitFor(async () => ((await orderMetadata(orderId)).stage === stage ? true : undefined), { timeoutMs: WAIT_MS })

    // Dựng cửa hàng + catalog + admin + hai khách. Region có thêm pp_system_default để hoàn tất giỏ và
    // capture payment không cần VNPAY thật (hoàn tiền của VNPAY được test riêng ở unit test).
    async function setup() {
      const container = getContainer()
      const store = await bootstrapStore(container)
      await seedCatalog(container, {
        regionId: store.regionId,
        salesChannelId: store.salesChannelId,
        stockLocationId: store.stockLocationId,
      })
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: store.regionId },
          update: { payment_providers: ["pp_vnpay_vnpay", "pp_system_default"] },
        },
      })
      const admin = await createAdminHeaders(api, container)
      const publishable = { "x-publishable-api-key": store.publishableKey }

      // Khách: đăng ký, tạo hồ sơ, đăng nhập lại để token có actor (verified-apis S7).
      async function createCustomer(email: string) {
        const register = await api.post("/auth/customer/emailpass/register", { email, password: PASSWORD })
        await api.post(
          "/store/customers",
          { email, first_name: "Khach" },
          { headers: { ...publishable, authorization: `Bearer ${register.data.token}` } }
        )
        const login = await api.post("/auth/customer/emailpass", { email, password: PASSWORD })
        return { headers: { ...publishable, authorization: `Bearer ${login.data.token}` } }
      }
      const owner = await createCustomer("chu-don@example.com")
      const stranger = await createCustomer("nguoi-la@example.com")

      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })

      // Tồn kho khả dụng của món đang đặt, đọc qua Store API như storefront.
      const stock = async (): Promise<number> => {
        const res = await api.get(
          `/store/products?limit=100&region_id=${store.regionId}&fields=+variants.inventory_quantity`,
          { headers: publishable }
        )
        const found = res.data.products.flatMap((p: any) => p.variants).find((v: any) => v.id === variant.id)
        return found.inventory_quantity
      }

      // Đơn thật của khách qua giỏ (S7), payment pp_system_default được capture như đã thanh toán.
      async function placeCapturedOrder(): Promise<string> {
        const { data } = await api.post(
          "/store/carts",
          {
            region_id: store.regionId,
            sales_channel_id: store.salesChannelId,
            email: "chu-don@example.com",
            shipping_address: {
              first_name: "An", last_name: "Nguyen", address_1: "1 Nguyen Van Linh", address_2: "Quận 7",
              city: "Ho Chi Minh", country_code: "vn", postal_code: "700000",
            },
            items: [{ variant_id: variant.id, quantity: QUANTITY }],
          },
          owner
        )
        const cartId = data.cart.id
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, owner)
        const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, owner)
        await api.post(
          `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          owner
        )
        const done = await api.post(`/store/carts/${cartId}/complete`, {}, owner)
        const orderId = done.data.order.id as string

        const [order] = await graph({
          entity: "order",
          fields: ["id", "payment_collections.payments.id"],
          filters: { id: orderId },
        })
        for (const collection of order.payment_collections) {
          for (const payment of collection.payments) {
            await capturePaymentWorkflow(container).run({ input: { payment_id: payment.id } })
          }
        }
        await waitForStage(orderId, "PENDING")
        return orderId
      }

      const refundsOf = async (orderId: string): Promise<any[]> => {
        const [order] = await graph({
          entity: "order",
          fields: ["id", "payment_collections.payments.id"],
          filters: { id: orderId },
        })
        const paymentIds = order.payment_collections.flatMap((c: any) => c.payments.map((p: any) => p.id))
        return graph({ entity: "refund", fields: ["id", "amount", "payment_id"], filters: { payment_id: paymentIds } })
      }

      const cancel = (orderId: string, as: { headers?: any } | undefined) =>
        api.post(`/store/orders/${orderId}/cancel`, {}, as).catch((e: any) => e.response)

      return { container, store, admin, owner, stranger, variant, stock, placeCapturedOrder, refundsOf, cancel }
    }

    describe("POST /store/orders/:id/cancel", () => {
      it("đơn PENDING của chính khách: 200, stage CANCELLED, trả tồn kho, có refund", async () => {
        const { owner, stock, placeCapturedOrder, refundsOf, cancel } = await setup()
        const before = await stock()
        const orderId = await placeCapturedOrder()
        expect(await stock()).toBe(before - QUANTITY)

        const res = await cancel(orderId, owner)
        expect(res.status).toBe(200)
        expect(res.data.order).toMatchObject({ id: orderId, status: "canceled" })

        // Stage do subscriber order.canceled (BE-6) đặt, nên chờ.
        await waitForStage(orderId, "CANCELLED")
        expect(await orderStatus(orderId)).toBe("canceled")
        expect(await stock()).toBe(before)

        const refunds = await refundsOf(orderId)
        expect(refunds).toHaveLength(1)
        expect(Number(refunds[0].amount)).toBeGreaterThan(0)
      })

      it("đơn đã CONFIRMED: 409 ORDER_NOT_CANCELLABLE, đơn giữ nguyên", async () => {
        const { admin, owner, stock, placeCapturedOrder, refundsOf, cancel } = await setup()
        const orderId = await placeCapturedOrder()
        await api.post(`/admin/orders/${orderId}/confirm`, {}, admin)
        await waitForStage(orderId, "CONFIRMED")
        const stockBefore = await stock()

        const res = await cancel(orderId, owner)
        expect(res.status).toBe(409)
        expect(res.data.code).toBe("ORDER_NOT_CANCELLABLE")

        expect((await orderMetadata(orderId)).stage).toBe("CONFIRMED")
        expect(await orderStatus(orderId)).not.toBe("canceled")
        expect(await stock()).toBe(stockBefore)
        expect(await refundsOf(orderId)).toHaveLength(0)
      })

      it("đơn của người khác: 404, đơn giữ nguyên", async () => {
        const { stranger, placeCapturedOrder, cancel } = await setup()
        const orderId = await placeCapturedOrder()

        const res = await cancel(orderId, stranger)
        expect(res.status).toBe(404)
        expect((await orderMetadata(orderId)).stage).toBe("PENDING")
        expect(await orderStatus(orderId)).not.toBe("canceled")
      })

      it("chưa đăng nhập: 401; đơn không tồn tại: 404", async () => {
        const { store, owner, placeCapturedOrder, cancel } = await setup()
        const orderId = await placeCapturedOrder()

        const anonymous = await cancel(orderId, { headers: { "x-publishable-api-key": store.publishableKey } })
        expect(anonymous.status).toBe(401)
        expect((await orderMetadata(orderId)).stage).toBe("PENDING")

        const missing = await cancel("order_khong_ton_tai", owner)
        expect(missing.status).toBe(404)
      })

      it("còn fulfillment chưa huỷ: 409 ORDER_NOT_CANCELLABLE dù stage vẫn là PENDING", async () => {
        const { container, owner, placeCapturedOrder, cancel } = await setup()
        const orderId = await placeCapturedOrder()

        const [order] = await graph({
          entity: "order",
          fields: ["id", "items.id", "items.detail.quantity"],
          filters: { id: orderId },
        })
        const items = order.items.map((i: any) => ({ id: i.id, quantity: i.detail.quantity }))
        await createOrderFulfillmentWorkflow(container).run({ input: { order_id: orderId, items } })
        await waitForStage(orderId, "PREPARING")

        // Tình huống lệch: fulfillment đã có nhưng stage còn PENDING (subscriber chưa kịp chạy).
        // Đưa stage về PENDING thủ công để chứng minh workflow tự kiểm fulfillment, không chỉ dựa vào stage.
        const metadata = await orderMetadata(orderId)
        await container.resolve(Modules.ORDER).updateOrders(orderId, { metadata: { ...metadata, stage: "PENDING" } })

        const res = await cancel(orderId, owner)
        expect(res.status).toBe(409)
        expect(res.data.code).toBe("ORDER_NOT_CANCELLABLE")
        expect(await orderStatus(orderId)).not.toBe("canceled")
      })

      it("refundPayment lỗi: 502 REFUND_FAILED, stage và tồn kho không đổi, không có refund", async () => {
        const { owner, stock, placeCapturedOrder, refundsOf, cancel } = await setup()
        const orderId = await placeCapturedOrder()
        const stockBefore = await stock()

        // Provider nằm trong container riêng của payment module nên chặn ở prototype của class.
        const refund = jest
          .spyOn(SystemPaymentProvider.prototype, "refundPayment")
          .mockRejectedValue(new MedusaError(MedusaError.Types.NOT_ALLOWED, "VNPAY refund rejected (code 95)"))
        try {
          const res = await cancel(orderId, owner)
          expect(refund).toHaveBeenCalled()
          expect(res.status).toBe(502)
          expect(res.data.code).toBe("REFUND_FAILED")
        } finally {
          refund.mockRestore()
        }

        // Chờ một nhịp để chắc không có order.canceled nào đến muộn.
        await new Promise((resolve) => setTimeout(resolve, 1500))
        expect((await orderMetadata(orderId)).stage).toBe("PENDING")
        expect(await orderStatus(orderId)).not.toBe("canceled")
        expect(await stock()).toBe(stockBefore)
        expect(await refundsOf(orderId)).toHaveLength(0)

        // Hết lỗi thì khách huỷ lại được (khoá đã nhả, đơn còn nguyên).
        const retry = await cancel(orderId, owner)
        expect(retry.status).toBe(200)
        await waitForStage(orderId, "CANCELLED")
      })
    })
  },
})
