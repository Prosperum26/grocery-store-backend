import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateInventoryLevelsWorkflow, updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { performance } from "perf_hooks"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"
import { releaseCartHoldWorkflow } from "../../src/workflows/release-cart-hold"
import { waitFor } from "./_helpers"

jest.setTimeout(900 * 1000)

const N = 100 // số giỏ gọi giữ hàng cùng lúc
const S0 = 5 // tồn ban đầu
const ROUNDS = 20
const WAIT_MS = 30000

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

// Thí nghiệm H4 của proposal qua HTTP thật (API-14): N = 100 giỏ tranh S0 = 5, lặp 20 lần.
// Kỳ vọng: đúng 5 giỏ giữ được mỗi lượt, tồn không bao giờ âm. In số liệu với tiền tố "H4" để ghi báo cáo.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const graph = async (args: any): Promise<any[]> =>
      (await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph(args)).data as any[]
    const hotStock = () => getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)
    const redis = () => (hotStock() as any).redis

    let cartCount = 0
    async function setup() {
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
      await updateInventoryLevelsWorkflow(container).run({ input: { updates: [{ ...ref, stocked_quantity: S0 }] } })
      const avail = async () => (await hotStock().available([ref]))[0]
      await waitFor(async () => ((await avail()) === S0 ? true : undefined), { timeoutMs: WAIT_MS })

      // Tạo lần lượt (Medusa lỗi khi tạo đồng thời nhiều giỏ khách vãng lai, verified-apis HS-4).
      async function carts(count: number, withPayment: boolean) {
        const ids: string[] = []
        for (let i = 0; i < count; i++) {
          const { data } = await api.post("/store/carts", {
            region_id: store.regionId, sales_channel_id: store.salesChannelId, email: `h4-${++cartCount}@example.com`,
            shipping_address: { first_name: "An", last_name: "Nguyen", address_1: "1 NVL", city: "HCM", country_code: "vn", postal_code: "700000" },
            items: [{ variant_id: variant.id, quantity: 1 }],
          }, headers)
          const cartId = data.cart.id as string
          if (withPayment) {
            await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: store.shippingOptionId }, headers)
            const { data: pc } = await api.post("/store/payment-collections", { cart_id: cartId }, headers)
            await api.post(`/store/payment-collections/${pc.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, headers)
          }
          ids.push(cartId)
        }
        return ids
      }
      // Gọi API-14 cho mọi giỏ cùng lúc, đo thời gian từng request phía client.
      async function race(cartIds: string[]) {
        const results = await Promise.all(
          cartIds.map(async (cartId) => {
            const start = performance.now()
            const res = await api.post(`/store/carts/${cartId}/reserve`, {}, headers).catch((e: any) => e.response)
            return { cartId, status: res.status as number, code: res.data?.code as string | undefined, ms: performance.now() - start }
          })
        )
        return results
      }
      return { container, ref, headers, avail, carts, race }
    }

    it(`H4: ${N} giỏ tranh ${S0} món, lặp ${ROUNDS} lần: đúng ${S0} giỏ giữ được, tồn không âm`, async () => {
      const ctx = await setup()
      const cartIds = await ctx.carts(N, false)
      const durations: number[] = []
      const rows: { round: number; held: number; out: number; other: number; avail: number }[] = []

      for (let round = 1; round <= ROUNDS; round++) {
        expect(await ctx.avail()).toBe(S0)
        const results = await ctx.race(cartIds)
        durations.push(...results.map((r) => r.ms))
        const held = results.filter((r) => r.status === 200)
        const row = {
          round,
          held: held.length,
          out: results.filter((r) => r.status === 409 && r.code === "OUT_OF_STOCK").length,
          other: results.filter((r) => r.status !== 200 && !(r.status === 409 && r.code === "OUT_OF_STOCK")).length,
          avail: (await ctx.avail())!,
        }
        rows.push(row)
        expect(row).toEqual({ round, held: S0, out: N - S0, other: 0, avail: 0 })
        // Trả hold của các giỏ thắng cho lượt sau (giỏ đã RELEASED thì giữ lại được, HS-2).
        await Promise.all(held.map((r) => hotStock().release(r.cartId)))
      }

      // Cùng 100 giỏ nhưng gọi lần lượt: tách thời gian xử lý một request khỏi thời gian xếp hàng khi 100 request tới cùng lúc.
      await ctx.race(cartIds.slice(0, S0)) // giữ hết 5 món: các lần sau đi đường 409, như phần lớn request trong H4
      const sequential: number[] = []
      for (const cartId of cartIds) {
        const start = performance.now()
        await api.post(`/store/carts/${cartId}/reserve`, {}, ctx.headers).catch((e: any) => e.response)
        sequential.push(performance.now() - start)
      }
      console.log(
        `H4 sequential: requests=${sequential.length} http_ms_p50=${percentile(sequential, 50).toFixed(1)} ` +
          `p95=${percentile(sequential, 95).toFixed(1)} p99=${percentile(sequential, 99).toFixed(1)}`
      )

      console.log(`H4 rounds: ${JSON.stringify(rows)}`)
      console.log(
        `H4 summary: N=${N} S0=${S0} rounds=${ROUNDS} held_per_round=${S0} min_avail=${Math.min(...rows.map((r) => r.avail))} ` +
          `requests=${durations.length} http_ms_p50=${percentile(durations, 50).toFixed(1)} p95=${percentile(durations, 95).toFixed(1)} ` +
          `p99=${percentile(durations, 99).toFixed(1)} max=${Math.max(...durations).toFixed(1)}`
      )
    })

    it("H4 đủ vòng: 5 giỏ thắng, 2 thanh toán lỗi trả hàng, 2 giỏ khác giữ lại được; cuối cùng đúng 5 đơn, không âm", async () => {
      const ctx = await setup()
      const cartIds = await ctx.carts(N, true)
      const first = await ctx.race(cartIds)
      const winners = first.filter((r) => r.status === 200).map((r) => r.cartId)
      expect(winners).toHaveLength(S0)

      // 3 giỏ trả tiền xong (hoàn tất giỏ → order.placed → hold CONFIRMED), 2 giỏ thanh toán lỗi (IPN thất bại → trả hàng).
      for (const cartId of winners.slice(0, 3)) {
        await api.post(`/store/carts/${cartId}/complete`, {}, ctx.headers)
      }
      for (const cartId of winners.slice(3)) {
        await releaseCartHoldWorkflow(ctx.container).run({ input: { cart_id: cartId } })
      }
      expect(await ctx.avail()).toBe(2)

      // Các giỏ thua thử lại cùng lúc: đúng 2 giỏ giữ được phần vừa trả, rồi trả tiền.
      const losers = cartIds.filter((id) => !winners.includes(id))
      const second = await ctx.race(losers)
      const late = second.filter((r) => r.status === 200).map((r) => r.cartId)
      expect(late).toHaveLength(2)
      for (const cartId of late) {
        await api.post(`/store/carts/${cartId}/complete`, {}, ctx.headers)
      }

      const orders = await graph({ entity: "order", fields: ["id"] })
      expect(orders).toHaveLength(S0)
      const [level] = await graph({ entity: "inventory_level", fields: ["stocked_quantity", "reserved_quantity"], filters: { inventory_item_id: ctx.ref.inventory_item_id } })
      expect([Number(level.stocked_quantity), Number(level.reserved_quantity)]).toEqual([S0, S0])
      await waitFor(async () => ((await ctx.avail()) === 0 ? true : undefined), { timeoutMs: WAIT_MS })
      console.log(`H4 full flow: winners=${winners.length} paid=3 failed_payment=2 retried_and_held=${late.length} orders=${orders.length} reserved=${level.reserved_quantity} avail=0`)
    })
  },
})
