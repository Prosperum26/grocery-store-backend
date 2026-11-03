import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { HOT_STOCK_MODULE } from "../../src/modules/hot-stock"
import type HotStockModuleService from "../../src/modules/hot-stock/service"

jest.setTimeout(120 * 1000)

// Cần container Redis (README: com4fud-redis). Khi NODE_ENV=test, medusa-config đặt tiền tố c4f-test: để không đụng key của DB dev.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("hot-stock module", () => {
      it("đã nạp, có kết nối Redis và đọc đúng options", async () => {
        const hotStock = getContainer().resolve<HotStockModuleService>(HOT_STOCK_MODULE)
        expect(await hotStock.ping()).toBe("PONG")
        expect(hotStock.prefix).toBe("c4f-test:")
        expect(hotStock.holdTtlSeconds).toBe(900)
      })
    })
  },
})
