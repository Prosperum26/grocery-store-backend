import { ExecArgs } from "@medusajs/framework/types"
import { bootstrapStore } from "../lib/seed/bootstrap-store"
import { seedCatalog } from "../lib/seed/seed-catalog"
import { seedPromotions } from "../lib/seed/seed-promotions"

// Chạy: npm run seed --workspace=@dtc/backend. Idempotent, chạy lại an toàn.
export default async function seed({ container }: ExecArgs) {
  const store = await bootstrapStore(container)
  console.log("Region:", store.regionId)
  console.log("Sales channel:", store.salesChannelId)
  console.log("Stock location:", store.stockLocationId)
  console.log("Shipping option:", store.shippingOptionId)
  console.log("Publishable key:", store.publishableKey)

  const catalog = await seedCatalog(container, store)
  console.log(`Catalog: created ${catalog.created}, skipped ${catalog.skipped}`)

  await seedPromotions(container, store)
  console.log("Promotions: TUOI20, THANHVIEN15, HETHAN5 (nhóm khách 'Thành viên')")
}
