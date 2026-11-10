import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow, uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { SeedCatalogData } from "./seed-data/catalog"

// Ảnh do tools/catalog/fetch_images.py tải về, tên file là <catalog_id>.webp (thư mục bị gitignore).
export const DEFAULT_IMAGES_DIR = join(__dirname, "seed-data", "images")
// Link ảnh gốc (CDN Bách Hoá Xanh) của từng sản phẩm, sinh từ xlsx bằng tools/catalog/build_image_manifest.py.
const MANIFEST_PATH = join(__dirname, "seed-data", "image-manifest.json")
// Upload và cập nhật theo lô để không gọi workflow cho từng sản phẩm trong catalog 2.129 món.
const BATCH_SIZE = 50

/** catalog_id → link ảnh gốc, đọc từ image-manifest.json đã commit. */
export function loadImageUrls(): Map<string, string> {
  const rows: { catalog_id: string; image_url: string }[] = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))
  return new Map(rows.map((r) => [r.catalog_id, r.image_url]))
}

/**
 * Gắn `thumbnail`/`images` cho sản phẩm trong DB. Với mỗi sản phẩm chưa có thumbnail:
 *   - có file <catalog_id>.webp đã tải về, hoặc manifest chứa ảnh base64 (data:image/...)
 *     → upload qua File Module (ảnh nằm trên backend);
 *   - không có file nhưng có link gốc → ghi thẳng link gốc (khi deploy không cần lưu file,
 *     nhưng ảnh phụ thuộc CDN của Bách Hoá Xanh: họ đổi hoặc xoá link thì ảnh vỡ);
 *   - không có cả hai → giữ nguyên, storefront hiện ảnh giữ chỗ.
 * Tách khỏi seedCatalog vì seedCatalog bỏ qua sản phẩm đã có, nên DB đã seed sẽ không bao giờ nhận ảnh.
 * Idempotent: sản phẩm đã có thumbnail thì bỏ qua. Cần vậy vì provider local thêm tiền tố timestamp
 * vào tên file, nên upload lại sẽ tạo thêm một bản mới thay vì ghi đè.
 */
export async function attachCatalogImages(
  container: MedusaContainer,
  catalog: SeedCatalogData,
  imagesDir: string = DEFAULT_IMAGES_DIR,
  imageUrls: Map<string, string> = loadImageUrls()
): Promise<{ uploaded: number; linked: number; hadThumbnail: number; missing: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const catalogIdByHandle = new Map<string, string>()
  for (const p of catalog.products) {
    if (p.metadata.catalog_id) catalogIdByHandle.set(p.handle, p.metadata.catalog_id)
  }

  // Chỉ xét sản phẩm đang có trong DB; sản phẩm của catalog chưa được seed thì bỏ qua.
  const { data: dbProducts } = await query.graph({ entity: "product", fields: ["id", "handle", "thumbnail"] })

  let hadThumbnail = 0
  let missing = 0
  // content() trả base64 của ảnh (dạng uploadFilesWorkflow nhận); chỉ đọc file khi tới lô của nó.
  const toUpload: { id: string; catalogId: string; mimeType: string; content: () => string }[] = []
  const toLink: { id: string; url: string }[] = []
  for (const product of dbProducts as { id: string; handle: string; thumbnail: string | null }[]) {
    const catalogId = catalogIdByHandle.get(product.handle)
    if (!catalogId) continue
    const url = imageUrls.get(catalogId)
    const file = join(imagesDir, `${catalogId}.webp`)
    const inline = url ? parseDataImage(url) : null
    if (product.thumbnail) {
      hadThumbnail++
    } else if (existsSync(file)) {
      toUpload.push({ id: product.id, catalogId, mimeType: "image/webp", content: () => readFileSync(file).toString("base64") })
    } else if (inline) {
      // Ảnh base64 dán thẳng trong xlsx: không ghi làm link được (dài hơn giới hạn index của cột
      // image.url trong Postgres, lỗi 54000), nên upload thành file như ảnh đã tải về.
      toUpload.push({ id: product.id, catalogId, mimeType: inline.mimeType, content: () => inline.content })
    } else if (url) {
      toLink.push({ id: product.id, url })
    } else {
      missing++
    }
  }

  for (let start = 0; start < toUpload.length; start += BATCH_SIZE) {
    const batch = toUpload.slice(start, start + BATCH_SIZE)
    // Kết quả upload trả về theo đúng thứ tự file đầu vào.
    const { result: uploaded } = await uploadFilesWorkflow(container).run({
      input: {
        files: batch.map(({ catalogId, mimeType, content }) => ({
          filename: `${catalogId}.${mimeType.split("/")[1]}`,
          mimeType,
          content: content(),
          access: "public" as const,
        })),
      },
    })
    await setImages(container, batch.map(({ id }, i) => ({ id, url: uploaded[i].url })))
  }

  for (let start = 0; start < toLink.length; start += BATCH_SIZE) {
    await setImages(container, toLink.slice(start, start + BATCH_SIZE))
  }

  return { uploaded: toUpload.length, linked: toLink.length, hadThumbnail, missing }
}

/** "data:image/webp;base64,AAAA" → { mimeType: "image/webp", content: "AAAA" }; link thường → null. */
function parseDataImage(url: string): { mimeType: string; content: string } | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(url)
  return match ? { mimeType: match[1], content: match[2] } : null
}

async function setImages(container: MedusaContainer, items: { id: string; url: string }[]) {
  await updateProductsWorkflow(container).run({
    input: { products: items.map(({ id, url }) => ({ id, thumbnail: url, images: [{ url }] })) },
  })
}
