import { ExecArgs } from "@medusajs/framework/types"
import { loadCatalogV2 } from "../lib/seed/seed-data/load-catalog-v2"
import { attachCatalogImages } from "../lib/seed/upload-images"

// Chỉ gắn ảnh cho catalog đã seed (không chạy lại cả seed).
// Chạy: npm run seed:images --workspace=@dtc/backend (tải ảnh trước bằng tools/catalog/fetch_images.py thì ảnh nằm trên backend, không thì dùng link gốc). Idempotent.
export default async function seedImages({ container }: ExecArgs) {
  const images = await attachCatalogImages(container, loadCatalogV2())
  console.log(`Images: uploaded ${images.uploaded}, linked to original URL ${images.linked}, already had ${images.hadThumbnail}, no image ${images.missing}`)
}
