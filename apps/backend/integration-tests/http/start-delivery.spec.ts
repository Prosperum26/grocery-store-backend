import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { createAdminHeaders } from "./_admin"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const WAIT_MS = 30000 // subscriber chạy bất đồng bộ

// Bật cờ này để hook ép createOrderShipmentWorkflow lỗi sau khi shipment đã được tạo
// (workflow phải rollback và không phát shipment.created).
let failShipment = false
createOrderShipmentWorkflow.hooks.shipmentCreated(async () => {
  if (failShipment) {
    throw new Error("forced shipment failure")
  }
})

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    const orderMetadata = async (orderId: string) =>
      ((await graph({ entity: "order", fields: ["id", "metadata"], filters: { id: orderId } }))[0].metadata ?? {}) as any

    const waitForStage = (orderId: string, stage: string) =>
      waitFor(async () => ((await orderMetadata(orderId)).stage === stage ? true : undefined), { timeoutMs: WAIT_MS })

    // Dựng cửa hàng + catalog + admin; cho region thêm provider mặc định để hoàn tất giỏ không cần VNPAY.
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
      const store_ = { headers: { "x-publishable-api-key": store.publishableKey } }
      const [variant] = await graph({
        entity: "product_variant",
        fields: ["id"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })

      // Đơn thật qua giỏ (S7), quận ghi ở address_2 để workflow lấy khoảng cách.
      async function placeOrder(district: string): Promise<string> {
        const { data } = await api.post(
          "/store/carts",
          {
            region_id: store.regionId,
            sales_channel_id: store.salesChannelId,
            email: "khach@example.com",
            shipping_address: {
              first_name: "An", last_name: "Nguyen", address_1: "1 Nguyen Van Linh", address_2: district,
              city: "Ho Chi Minh", country_code: "vn", postal_code: "700000",
            },
            items: [{ variant_id: variant.id, quantity: 2 }],
          },
          store_
        )
        const cartId = data.cart.id
        await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, store_)
        const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, store_)
        await api.post(
          `/store/payment-collections/${pc.payment_collection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          store_
        )
        const done = await api.post(`/store/carts/${cartId}/complete`, {}, store_)
        const orderId = done.data.order.id
        await waitForStage(orderId, "PENDING")
        return orderId
      }

      // Đưa đơn tới PREPARING: xác nhận rồi tạo fulfillment (hai event thật do subscriber BE-6 xử lý).
      async function placePreparingOrder(district: string) {
        const orderId = await placeOrder(district)
        await api.post(`/admin/orders/${orderId}/confirm`, {}, admin)
        await waitForStage(orderId, "CONFIRMED")
        const [order] = await graph({
          entity: "order",
          fields: ["id", "items.id", "items.detail.quantity"],
          filters: { id: orderId },
        })
        const items = order.items.map((i: any) => ({ id: i.id, quantity: i.detail.quantity }))
        const { result: fulfillment } = await createOrderFulfillmentWorkflow(container).run({
          input: { order_id: orderId, items },
        })
        await waitForStage(orderId, "PREPARING")
        return { orderId, fulfillmentId: fulfillment.id as string }
      }

      const shippedAt = async (fulfillmentId: string) =>
        (await graph({ entity: "fulfillment", fields: ["id", "shipped_at"], filters: { id: fulfillmentId } }))[0].shipped_at

      return { container, admin, placeOrder, placePreparingOrder, shippedAt }
    }

    describe("POST /admin/orders/:id/start-delivery", () => {
      afterEach(() => {
        failShipment = false
      })

      it("đơn PREPARING: 200, ghi metadata.delivery với ETA theo quận, stage sang SHIPPING", async () => {
        const { admin, placePreparingOrder, shippedAt } = await setup()
        const { orderId, fulfillmentId } = await placePreparingOrder("Quận 7")

        const res = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin)
        expect(res.status).toBe(200)

        await waitForStage(orderId, "SHIPPING")
        const metadata = await orderMetadata(orderId)
        const delivery = metadata.delivery
        expect(delivery.distance_km).toBe(3)
        expect(delivery.eta_at).toEqual(expect.any(String))
        // Quận 7: 3 km / 20 km/h = 9 phút.
        expect(new Date(delivery.eta_at).getTime() - new Date(delivery.started_at).getTime()).toBe(9 * 60 * 1000)
        expect(delivery.notice_sent_at).toEqual(expect.any(String))
        expect(res.data.delivery).toEqual(delivery)

        expect(await shippedAt(fulfillmentId)).toBeTruthy()
        expect(metadata.stage_log.map((entry: any) => entry.stage)).toEqual([
          "PENDING", "CONFIRMED", "PREPARING", "SHIPPING",
        ])

        // Bấm lần hai (đã giao đi rồi): 409, delivery không đổi.
        const again = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin).catch((e: any) => e.response)
        expect(again.status).toBe(409)
        expect((await orderMetadata(orderId)).delivery).toEqual(delivery)
      })

      it("quận không nhận ra dùng 6 km mặc định", async () => {
        const { admin, placePreparingOrder } = await setup()
        const { orderId } = await placePreparingOrder("Huyện Lạ")

        const res = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin)
        expect(res.status).toBe(200)
        expect(res.data.delivery.distance_km).toBe(6)
      })

      it("đơn PENDING: 409 và metadata không đổi", async () => {
        const { admin, placeOrder } = await setup()
        const orderId = await placeOrder("Quận 7")
        const before = await orderMetadata(orderId)

        const res = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin).catch((e: any) => e.response)
        expect(res.status).toBe(409)
        expect(await orderMetadata(orderId)).toEqual(before)
        expect(before.delivery).toBeUndefined()
      })

      it("chưa đăng nhập 401, đơn không tồn tại 404", async () => {
        const { admin } = await setup()
        const anonymous = await api.post("/admin/orders/order_x/start-delivery", {}).catch((e: any) => e.response)
        expect(anonymous.status).toBe(401)

        const missing = await api
          .post("/admin/orders/order_khong_ton_tai/start-delivery", {}, admin)
          .catch((e: any) => e.response)
        expect(missing.status).toBe(404)
      })

      it("createOrderShipmentWorkflow lỗi: metadata.delivery khôi phục về giá trị cũ, stage vẫn PREPARING", async () => {
        const { container, admin, placePreparingOrder, shippedAt } = await setup()
        const { orderId, fulfillmentId } = await placePreparingOrder("Quận 7")

        // Đặt sẵn một giá trị delivery cũ: nếu bước ghi chạy rồi không được bù trừ thì giá trị này sẽ bị thay.
        const previous = { distance_km: 1, eta_at: "2026-01-01T00:00:00.000Z" }
        const current = await orderMetadata(orderId)
        await container
          .resolve(Modules.ORDER)
          .updateOrders(orderId, { metadata: { ...current, delivery: previous } })

        failShipment = true
        const res = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin).catch((e: any) => e.response)
        expect(res.status).toBeGreaterThanOrEqual(400)

        // Chờ một nhịp để chắc không có event shipment.created nào đến muộn.
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const metadata = await orderMetadata(orderId)
        expect(metadata.delivery).toEqual(previous)
        expect(metadata.stage).toBe("PREPARING")
        expect(await shippedAt(fulfillmentId)).toBeFalsy()

        // Tắt cờ thì thử lại được bình thường (khoá đã nhả, shipment chưa tạo).
        failShipment = false
        const retry = await api.post(`/admin/orders/${orderId}/start-delivery`, {}, admin)
        expect(retry.status).toBe(200)
        await waitForStage(orderId, "SHIPPING")
        expect((await orderMetadata(orderId)).delivery.distance_km).toBe(3)
      })
    })
  },
})
