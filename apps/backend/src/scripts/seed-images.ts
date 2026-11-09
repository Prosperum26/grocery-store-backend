import { ExecArgs } from "@medusajs/framework/types"
import { loadCatalogV2 } from "../lib/seed/seed-data/load-catalog-v2"
import { attachCatalogImages } from "../lib/seed/upload-images"

// Chỉ gắn ảnh cho catalog đã seed (không chạy lại cả seed).
// Chạy: python tools/catalog/fetch_images.py rồi npm run seed:images --workspace=@dtc/backend. Idempotent.
export default async function seedImages({ container }: ExecArgs) {
  const images = await attachCatalogImages(container, loadCatalogV2())
  console.log(`Images: attached ${images.attached}, already had ${images.hadThumbnail}, missing file ${images.missingFile}`)
}
