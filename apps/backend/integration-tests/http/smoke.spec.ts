import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("smoke", () => {
      it("health", async () => {
        expect((await api.get("/health")).status).toBe(200)
      })
    })
  },
})
