import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"

jest.setTimeout(120 * 1000)

const IN_DEVELOPMENT = { code: "IN_DEVELOPMENT", type: "not_implemented", message: "Đang trong quá trình phát triển" }

// Trợ lý Bếp, bản giữ chỗ theo hợp đồng AI-0 (API-8, docs/contracts/ai-copilot.md): kiểm body, trả 501.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Trợ lý Bếp (bản giữ chỗ, API-8)", () => {
      it("body đúng hợp đồng: 501 đang phát triển; body sai: 400; thiếu publishable key: 400; route cũ không còn", async () => {
        const store = await bootstrapStore(getContainer())
        const headers = { headers: { "x-publishable-api-key": store.publishableKey } }
        const post = (url: string, body: unknown, options = headers) =>
          api.post(url, body, options).catch((e: any) => e.response)

        const cases: [string, unknown, number][] = []
        for (const url of ["/store/ai/search", "/store/ai/copilot"]) {
          cases.push(
            [url, { query: "canh chua cá lóc" }, 501],
            [url, { query: "canh chua cá lóc cho 4 người", servings: 4, top_k: 5, have: ["cà chua", "CAT-000939"] }, 501],
            [url, {}, 400],
            [url, { query: "   " }, 400],
            [url, { query: "x".repeat(301) }, 400],
            [url, { query: "canh chua", servings: 0 }, 400],
            [url, { query: "canh chua", top_k: 11 }, 400],
            [url, { query: "canh chua", have: "cà chua" }, 400]
          )
        }
        for (const [url, body, status] of cases) {
          const res = await post(url, body)
          expect({ url, body, status: res.status }).toEqual({ url, body, status })
          if (status === 501) {
            expect(res.data).toEqual(IN_DEVELOPMENT)
          }
        }

        // Như mọi route /store/*, thiếu publishable key thì bị từ chối trước khi tới route.
        const noKey = await post("/store/ai/search", { query: "canh chua" }, { headers: {} } as any)
        expect(noKey.status).toBe(400)

        // Hợp đồng BE-10 cũ đã bỏ.
        for (const old of ["/store/recipes/semantic-search", "/store/assistant/chat"]) {
          expect({ old, status: (await post(old, { query: "x", message: "x" })).status }).toEqual({ old, status: 404 })
        }
      })
    })
  },
})
