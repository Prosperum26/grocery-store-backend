import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"

jest.setTimeout(120 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("bootstrapStore", () => {
      it("is idempotent", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        // query.graph trả kiểu rộng; ép any để đọc các trường quan hệ trong assertion.
        const graph = async (args: any): Promise<any[]> => (await query.graph(args)).data as any[]

        const first = await bootstrapStore(container)
        const second = await bootstrapStore(container)

        // Lần hai trả đúng các id của lần một.
        expect(second).toEqual(first)

        const regions = await graph({
          entity: "region",
          fields: ["id", "name", "currency_code", "countries.iso_2", "payment_providers.id"],
          filters: { name: "Việt Nam" },
        })
        expect(regions).toHaveLength(1)
        expect(regions[0].currency_code).toBe("vnd")
        expect(regions[0].countries.map((c: any) => c.iso_2)).toEqual(["vn"])
        expect(regions[0].payment_providers.map((p: any) => p.id)).toEqual(["pp_system_default"])

        const stores = await graph({
          entity: "store",
          fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default", "default_sales_channel_id"],
        })
        expect(stores).toHaveLength(1)
        expect(stores[0].supported_currencies).toEqual([{ currency_code: "vnd", is_default: true }])
        expect(stores[0].default_sales_channel_id).toBe(first.salesChannelId)

        const locations = await graph({
          entity: "stock_location",
          fields: ["id", "name", "sales_channels.id"],
          filters: { name: "Kho Q.7" },
        })
        expect(locations).toHaveLength(1)
        expect(locations[0].id).toBe(first.stockLocationId)
        expect(locations[0].sales_channels.map((s: any) => s.id)).toEqual([first.salesChannelId])

        const options = await graph({
          entity: "shipping_option",
          fields: ["id", "name", "prices.amount", "prices.currency_code"],
          filters: { name: "Giao tận nhà" },
        })
        expect(options).toHaveLength(1)
        expect(options[0].id).toBe(first.shippingOptionId)
        expect(options[0].prices.map((p: any) => [p.currency_code, Number(p.amount)])).toEqual([["vnd", 15000]])

        const keys = await graph({
          entity: "api_key",
          fields: ["id", "token", "type", "sales_channels.id"],
          filters: { type: "publishable" },
        })
        expect(keys).toHaveLength(1)
        expect(keys[0].token).toBe(first.publishableKey)
        expect(keys[0].sales_channels.map((s: any) => s.id)).toEqual([first.salesChannelId])
      })
    })
  },
})
