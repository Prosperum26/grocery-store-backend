import { ExecArgs } from "@medusajs/framework/types"
import { bootstrapStore } from "../lib/seed/bootstrap-store"
import { seedCatalog } from "../lib/seed/seed-catalog"
import { attachCatalogImages } from "../lib/seed/upload-images"
import { loadCatalogV2 } from "../lib/seed/seed-data/load-catalog-v2"
import { seedDemo } from "../lib/seed/seed-demo"
import { DEMO_DATA } from "../lib/seed/seed-data/demo"
import { seedPromotions } from "../lib/seed/seed-promotions"
import { syncHotStockWorkflow } from "../workflows/sync-hot-stock"

// Chạy: npm run seed --workspace=@dtc/backend. Idempotent, chạy lại an toàn.
export default async function seed({ container }: ExecArgs) {
  const store = await bootstrapStore(container)
  console.log("Region:", store.regionId)
  console.log("Sales channel:", store.salesChannelId)
  console.log("Stock location:", store.stockLocationId)
  console.log("Shipping option:", store.shippingOptionId)
  console.log("Publishable key:", store.publishableKey)

  // Catalog thật 2.129 món (BE-2). Test vẫn dùng bộ 32 món mặc định của seedCatalog.
  const catalogData = loadCatalogV2()
  const catalog = await seedCatalog(container, store, catalogData)
  console.log(`Catalog: created ${catalog.created}, skipped ${catalog.skipped}`)

  // Ảnh sản phẩm (BE-2b): chỉ gắn những ảnh đã tải bằng tools/catalog/fetch_images.py, thiếu thì bỏ qua.
  const images = await attachCatalogImages(container, catalogData)
  console.log(`Images: attached ${images.attached}, already had ${images.hadThumbnail}, missing file ${images.missingFile}`)

  await seedPromotions(container, store)
  console.log("Promotions: TUOI20, THANHVIEN15, HETHAN5 (nhóm khách 'Thành viên')")

  // Khách, admin và đơn demo (BE-2c). Mật khẩu chung đọc từ .env, không viết trong repo.
  const password = process.env.DEMO_PASSWORD
  if (!password) {
    console.warn("Bỏ qua khách/admin/đơn demo: chưa đặt DEMO_PASSWORD trong apps/backend/.env")
  } else {
    const demo = await seedDemo(container, store, DEMO_DATA, password)
    console.log(`Demo: admin ${demo.admin ? "created" : "exists"}, ${demo.customers} customers, created ${demo.orders} orders`)
  }

  // Cuối cùng (sau đơn demo có reservation): đẩy tồn kho sang Redis cho cổng giữ hàng (hot-stock HS-3).
  const { result } = await syncHotStockWorkflow(container).run({ input: {} })
  console.log(`Hot-stock: ${result.synced} items synced to Redis`)
}
