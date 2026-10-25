import { ExecArgs } from "@medusajs/framework/types"
import { bootstrapStore } from "../lib/seed/bootstrap-store"

// Chạy: npm run seed --workspace=@dtc/backend. Idempotent, chạy lại an toàn.
export default async function seed({ container }: ExecArgs) {
  const result = await bootstrapStore(container)
  console.log("Region:", result.regionId)
  console.log("Sales channel:", result.salesChannelId)
  console.log("Stock location:", result.stockLocationId)
  console.log("Shipping option:", result.shippingOptionId)
  console.log("Publishable key:", result.publishableKey)
}
