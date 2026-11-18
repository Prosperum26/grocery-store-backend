import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { seedDemo } from "../../src/lib/seed/seed-demo"
import { seedPromotions } from "../../src/lib/seed/seed-promotions"
import { DEMO_DATA } from "../../src/lib/seed/seed-data/demo"
import { withFixtureSkus } from "./_demo"
import { waitFor } from "./_helpers"

jest.setTimeout(300 * 1000)

const PASSWORD = "Passw0rd!"
const MINHTHU = "minhthu@com4fud.demo"

// Bước Medusa mà mỗi stage demo phải đã đi tới (fulfillment_status của đơn).
const EXPECTED_FULFILLMENT: Record<string, string> = {
  PENDING: "not_fulfilled",
  PREPARING: "fulfilled",
  SHIPPING: "shipped",
  DELIVERED: "delivered",
  CANCELLED: "not_fulfilled",
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]

    describe("seedDemo", () => {
      it("tạo admin, khách, đơn demo đúng stage và chạy lại không nhân đôi", async () => {
        const container = getContainer()
        const store = await bootstrapStore(container)
        await seedCatalog(container, store)
        await seedPromotions(container, store)
        const { data } = withFixtureSkus(DEMO_DATA)

        const first = await seedDemo(container, store, data, PASSWORD)
        expect(first).toEqual({ admin: true, customers: 2, orders: data.orders.length })
        const second = await seedDemo(container, store, data, PASSWORD)
        expect(second).toEqual({ admin: false, customers: 2, orders: 0 })
        expect(await graph({ entity: "order", fields: ["id"] })).toHaveLength(data.orders.length)

        // Admin và khách đăng nhập được bằng DEMO_PASSWORD.
        const adminLogin = await api.post("/auth/user/emailpass", { email: DEMO_DATA.admin_email, password: PASSWORD })
        const admin = { headers: { authorization: `Bearer ${adminLogin.data.token}` } }
        const login = await api.post("/auth/customer/emailpass", { email: MINHTHU, password: PASSWORD })
        const customer = {
          headers: { "x-publishable-api-key": store.publishableKey, authorization: `Bearer ${login.data.token}` },
        }

        const me = await api.get("/store/customers/me?fields=*addresses", customer)
        expect(me.data.customer.addresses.map((a: any) => a.address_name).sort()).toEqual(["Nhà riêng", "Văn phòng"])
        // Store API không trả groups của khách, nên đọc qua query.
        const [member] = await graph({ entity: "customer", fields: ["groups.name"], filters: { email: MINHTHU } })
        expect(member.groups.map((g: any) => g.name)).toEqual(["Thành viên"])

        // Mỗi đơn có đúng stage, stage_log theo timeline, và đã đi tới bước Medusa tương ứng.
        // fulfillment_status / payment_status là trường tính ra, query.graph không trả; đọc qua Admin API
        // (cũng là cái trang Admin hiển thị).
        const adminList = await api.get(
          "/admin/orders?limit=50&fields=id,status,fulfillment_status,payment_status,metadata",
          admin
        )
        const orders: any[] = adminList.data.orders
        for (const demo of data.orders) {
          const order = orders.find((o) => o.metadata?.code === demo.code)
          expect({ code: demo.code, stage: order.metadata.stage }).toEqual({ code: demo.code, stage: demo.stage })
          expect(order.metadata.stage_log.map((l: any) => l.stage)).toEqual(demo.timeline.map((t) => t.stage))
          expect({ code: demo.code, f: order.fulfillment_status }).toEqual({
            code: demo.code,
            f: EXPECTED_FULFILLMENT[demo.stage],
          })
          if (demo.stage === "CANCELLED") {
            expect(order.status).toBe("canceled")
          } else {
            expect({ code: demo.code, p: order.payment_status }).toEqual({ code: demo.code, p: "captured" })
          }
        }

        // Khách thấy đơn của mình qua Store API, kèm metadata.stage.
        const list = await api.get("/store/orders?fields=+metadata&limit=50", customer)
        expect(list.data.orders).toHaveLength(data.orders.length)

        // Đơn PENDING dùng được cho demo khách huỷ (BE-8): hoàn tiền rồi huỷ.
        const pending = orders.find((o) => o.metadata?.code === "C4F-DEMO-PENDING")
        const cancel = await api.post(`/store/orders/${pending.id}/cancel`, {}, customer)
        expect(cancel.status).toBe(200)
        await waitFor(
          async () =>
            (await graph({ entity: "order", fields: ["metadata"], filters: { id: pending.id } }))[0].metadata
              .stage === "CANCELLED" || undefined,
          { timeoutMs: 30000 }
        )

        // Đơn PREPARING dùng được cho demo "Bắt đầu giao" (BE-7), địa chỉ Quận 7.
        const preparing = orders.find((o) => o.metadata?.code === "C4F-DEMO-PREPARING")
        const start = await api.post(
          `/admin/orders/${preparing.id}/start-delivery`,
          { driver_name: "Nguyễn Văn Đức", plate: "59-X3 482.17" },
          admin
        )
        expect(start.status).toBe(200)
        expect(start.data.delivery.driver_name).toBe("Nguyễn Văn Đức")
      })
    })
  },
})
