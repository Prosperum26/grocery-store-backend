import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"

jest.setTimeout(120 * 1000)

// 23:30 ngày 26/10/2026 giờ VN: khung hôm nay đã qua, khung sáng 27/10 còn đặt được.
const NOW = "2026-10-26T16:30:00Z"

// Chỉ giả `Date` (app chạy cùng tiến trình với test); timer thật vẫn chạy để DB và HTTP không treo.
async function atTime<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame",
      "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate",
      "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout",
    ],
  })
  try {
    return await fn()
  } finally {
    jest.useRealTimers()
  }
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    async function setup() {
      const store = await bootstrapStore(getContainer())
      const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
      const { data } = await api.post(
        "/store/carts",
        { region_id: store.regionId, sales_channel_id: store.salesChannelId, metadata: { delivery_note: "Gọi trước 10 phút" } },
        headers
      )
      return { headers, cartId: data.cart.id as string }
    }

    const postSlot = (headers: any, cartId: string, body: unknown): Promise<any> =>
      atTime<any>(NOW, () =>
        api.post(`/store/carts/${cartId}/delivery-slot`, body, headers).catch((e: any) => e.response)
      )

    const readCartMetadata = async (headers: any, cartId: string) =>
      (await api.get(`/store/carts/${cartId}?fields=+metadata`, headers)).data.cart.metadata

    describe("delivery slots", () => {
      it("GET /store/delivery-slots trả { slots } với available theo giờ hiện tại", async () => {
        const { headers } = await setup()
        const res: any = await atTime(NOW, () => api.get("/store/delivery-slots", headers))

        expect(res.status).toBe(200)
        const slots: any[] = res.data.slots
        expect(slots.find((s) => s.id === "2026-10-27T07")).toMatchObject({
          label: "07:00–09:00",
          fee: 15000,
          available: true,
        })
        expect(slots.find((s) => s.id === "2026-10-26T19")).toMatchObject({ available: false })
      })

      it("chọn khung hợp lệ thì ghi cart.metadata.slot và giữ metadata cũ", async () => {
        const { headers, cartId } = await setup()
        const res = await postSlot(headers, cartId, { slot_id: "2026-10-27T07" })

        expect(res.status).toBe(200)
        const metadata = await readCartMetadata(headers, cartId)
        expect(metadata.slot).toMatchObject({
          id: "2026-10-27T07",
          label: "07:00–09:00",
          startsAt: "2026-10-27T07:00:00+07:00",
          endsAt: "2026-10-27T09:00:00+07:00",
          fee: 15000,
        })
        expect(metadata.delivery_note).toBe("Gọi trước 10 phút")
      })

      it("khung không còn đặt được thì 409 SLOT_UNAVAILABLE và giỏ không đổi", async () => {
        const { headers, cartId } = await setup()
        const res = await postSlot(headers, cartId, { slot_id: "2026-10-26T19" })

        expect(res.status).toBe(409)
        expect(res.data.code).toBe("SLOT_UNAVAILABLE")
        expect((await readCartMetadata(headers, cartId)).slot).toBeUndefined()
      })

      it("slot_id không tồn tại thì 404", async () => {
        const { headers, cartId } = await setup()
        for (const slot_id of ["2020-01-01T07", "2026-10-27T08", "khong-co"]) {
          const res = await postSlot(headers, cartId, { slot_id })
          expect({ slot_id, status: res.status }).toEqual({ slot_id, status: 404 })
          // Thông điệp nêu đúng khung bị thiếu (route chưa có cũng trả 404 nhưng không có chuỗi này).
          expect(res.data.message).toContain(slot_id)
        }
      })

      it("giỏ không tồn tại thì 404", async () => {
        const { headers } = await setup()
        const res = await postSlot(headers, "cart_khong_ton_tai", { slot_id: "2026-10-27T07" })
        expect(res.status).toBe(404)
        expect(res.data.message).toContain("cart_khong_ton_tai")
      })

      it("thiếu slot_id thì 400", async () => {
        const { headers, cartId } = await setup()
        const res = await postSlot(headers, cartId, {})
        expect(res.status).toBe(400)
      })
    })
  },
})
