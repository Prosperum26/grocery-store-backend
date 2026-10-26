import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  cancelOrderWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  createOrderWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  updateRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
import backfill, { backfillOrderStages } from "../../src/scripts/backfill-order-stage"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { setOrderStageWorkflow } from "../../src/workflows/set-order-stage"
import { createAdminHeaders } from "./_admin"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const WAIT_MS = 30000 // subscriber chạy bất đồng bộ

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

    const emit = (name: string, data: unknown) =>
      getContainer().resolve(Modules.EVENT_BUS).emit({ name, data } as any)

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
        fields: ["id", "title"],
        filters: { sku: CATALOG[0].variants[0].sku },
      })

      // Đơn thật qua giỏ (S7): có shipping method và reservation; completeCartWorkflow phát order.placed.
      async function placeOrder(): Promise<string> {
        const { data } = await api.post(
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
        return done.data.order.id
      }

      // Đơn tạo bằng createOrderWorkflow: không phát order.placed (V3), không có reservation.
      async function createBareOrder(metadata: Record<string, unknown> = {}): Promise<string> {
        const { result } = await createOrderWorkflow(container).run({
          input: {
            region_id: store.regionId,
            sales_channel_id: store.salesChannelId,
            currency_code: "vnd",
            email: "khach@example.com",
            status: "pending",
            items: [{ variant_id: variant.id, quantity: 1, title: "Cà chua", unit_price: 32000 }],
            metadata,
          } as any,
        })
        return result.id
      }

      return { container, store, admin, placeOrder, createBareOrder }
    }

    describe("stage đơn hàng theo sự kiện", () => {
      it("đi hết chuỗi PENDING -> CONFIRMED -> PREPARING -> SHIPPING -> DELIVERED và chặn đi lùi", async () => {
        const { container, admin, placeOrder } = await setup()
        const orderId = await placeOrder()

        // order.placed thật do completeCartWorkflow phát.
        await waitForStage(orderId, "PENDING")

        const confirmed = await api.post(`/admin/orders/${orderId}/confirm`, {}, admin)
        expect(confirmed.status).toBe(200)
        await waitForStage(orderId, "CONFIRMED")

        const [order] = await graph({ entity: "order", fields: ["id", "items.id", "items.detail.quantity"], filters: { id: orderId } })
        const items = order.items.map((i: any) => ({ id: i.id, quantity: i.detail.quantity }))

        const { result: fulfillment } = await createOrderFulfillmentWorkflow(container).run({
          input: { order_id: orderId, items },
        })
        await waitForStage(orderId, "PREPARING")

        await createOrderShipmentWorkflow(container).run({
          input: { order_id: orderId, fulfillment_id: fulfillment.id, items },
        })
        await waitForStage(orderId, "SHIPPING")

        await markOrderFulfillmentAsDeliveredWorkflow(container).run({
          input: { orderId, fulfillmentId: fulfillment.id },
        })
        await waitForStage(orderId, "DELIVERED")

        // Đã DELIVERED thì không lùi về PREPARING; workflow ném INVALID_DATA, stage giữ nguyên.
        await expect(
          setOrderStageWorkflow(container).run({ input: { order_id: orderId, stage: "PREPARING" } })
        ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })

        const metadata = await orderMetadata(orderId)
        expect(metadata.stage).toBe("DELIVERED")
        expect(metadata.stage_log.map((entry: any) => entry.stage)).toEqual([
          "PENDING", "CONFIRMED", "PREPARING", "SHIPPING", "DELIVERED",
        ])
        for (const entry of metadata.stage_log) {
          expect(entry).toEqual({ stage: expect.any(String), at: expect.any(String), by: expect.any(String) })
        }

        // Phát lại cùng các event (giao lặp hoặc lệch thứ tự). Mỗi event phải bị từ chối bằng
        // INVALID_DATA và chỉ ghi cảnh báo (đếm cảnh báo để chắc subscriber đã chạy), stage_log không đổi.
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        const warn = jest.spyOn(logger, "warn")
        const ignored = () => warn.mock.calls.filter(([msg]) => String(msg).includes("order-stage:")).length
        await emit("order.placed", { id: orderId })
        await emit("order.fulfillment_created", { order_id: orderId, fulfillment_id: fulfillment.id })
        await emit("shipment.created", { id: fulfillment.id })
        await emit("delivery.created", { id: fulfillment.id })
        await waitFor(async () => (ignored() >= 4 ? true : undefined), { timeoutMs: WAIT_MS })
        warn.mockRestore()
        const after = await orderMetadata(orderId)
        expect(after.stage).toBe("DELIVERED")
        expect(after.stage_log).toHaveLength(5)
      })

      it("huỷ đơn PENDING -> CANCELLED; xác nhận đơn đã huỷ bị từ chối", async () => {
        const { container, admin, placeOrder } = await setup()
        const orderId = await placeOrder()
        await waitForStage(orderId, "PENDING")

        await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
        await waitForStage(orderId, "CANCELLED")

        const res = await api.post(`/admin/orders/${orderId}/confirm`, {}, admin).catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect((await orderMetadata(orderId)).stage).toBe("CANCELLED")
      })

      it("createOrderWorkflow không phát order.placed: phát thủ công thì thành PENDING và giữ metadata cũ", async () => {
        const { createBareOrder } = await setup()
        const orderId = await createBareOrder({ ghi_chu: "giu lai" })

        await new Promise((resolve) => setTimeout(resolve, 1500))
        expect((await orderMetadata(orderId)).stage).toBeUndefined()

        await emit("order.placed", { id: orderId })
        await waitForStage(orderId, "PENDING")
        const metadata = await orderMetadata(orderId)
        expect(metadata.ghi_chu).toBe("giu lai")
        expect(metadata.stage_log).toHaveLength(1)
      })

      it("route confirm: chưa đăng nhập 401, đơn không tồn tại 404", async () => {
        const { admin } = await setup()
        const anonymous = await api.post("/admin/orders/order_x/confirm", {}).catch((e: any) => e.response)
        expect(anonymous.status).toBe(401)

        const missing = await api.post("/admin/orders/order_khong_ton_tai/confirm", {}, admin).catch((e: any) => e.response)
        expect(missing.status).toBe(404)
      })
    })

    describe("backfill-order-stage", () => {
      it("đặt stage suy ra cho đơn chưa có, không đụng đơn đã có, chạy lần hai không đổi", async () => {
        const { container, createBareOrder, placeOrder } = await setup()

        // Đơn đã có stage từ event: backfill không được sửa.
        const staged = await placeOrder()
        await waitForStage(staged, "PENDING")
        const stagedBefore = await orderMetadata(staged)

        // Đơn cũ chưa có stage: một đơn chờ xử lý, một đơn đã huỷ (huỷ từ trạng thái chưa có stage
        // thì subscriber không đặt được CANCELLED vì undefined chỉ được vào PENDING).
        const pendingLegacy = await createBareOrder()
        const canceledLegacy = await createBareOrder()
        await cancelOrderWorkflow(container).run({ input: { order_id: canceledLegacy } })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        expect((await orderMetadata(canceledLegacy)).stage).toBeUndefined()

        const first = await backfillOrderStages(container)
        expect(first.updated).toBe(2)
        expect((await orderMetadata(pendingLegacy)).stage).toBe("PENDING")
        expect((await orderMetadata(canceledLegacy)).stage).toBe("CANCELLED")
        expect((await orderMetadata(pendingLegacy)).stage_log).toEqual([
          { stage: "PENDING", at: expect.any(String), by: "backfill" },
        ])
        expect(await orderMetadata(staged)).toEqual(stagedBefore)

        const snapshot = await Promise.all([pendingLegacy, canceledLegacy].map(orderMetadata))
        const second = await backfillOrderStages(container)
        expect(second.updated).toBe(0)
        expect(await Promise.all([pendingLegacy, canceledLegacy].map(orderMetadata))).toEqual(snapshot)

        // Điểm vào của `medusa exec` cũng chạy được.
        await expect(backfill({ container } as any)).resolves.toBeUndefined()
      })
    })
  },
})
