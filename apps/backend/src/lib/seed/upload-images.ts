import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow, uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { SeedCatalogData } from "./seed-data/catalog"

// Ảnh do tools/catalog/fetch_images.py tải về, tên file là <catalog_id>.webp (thư mục bị gitignore).
export const DEFAULT_IMAGES_DIR = join(__dirname, "seed-data", "images")
// Upload và cập nhật theo lô để không gọi workflow cho từng sản phẩm trong catalog 2.129 món.
const BATCH_SIZE = 50

/**
 * Upload ảnh qua File Module và gắn `thumbnail`/`images` cho sản phẩm trong DB.
 * Tách khỏi seedCatalog vì seedCatalog bỏ qua sản phẩm đã có, nên DB đã seed sẽ không bao giờ nhận ảnh.
 * Idempotent: sản phẩm đã có thumbnail thì bỏ qua. Cần vậy vì provider local thêm tiền tố timestamp
 * vào tên file, nên upload lại sẽ tạo thêm một bản mới thay vì ghi đè.
 * Sản phẩm không có file ảnh (chưa tải, hoặc xlsx không có link) được giữ nguyên.
 */
export async function attachCatalogImages(
  container: MedusaContainer,
  catalog: SeedCatalogData,
  imagesDir: string = DEFAULT_IMAGES_DIR
): Promise<{ attached: number; hadThumbnail: number; missingFile: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const catalogIdByHandle = new Map<string, string>()
  for (const p of catalog.products) {
    if (p.metadata.catalog_id) catalogIdByHandle.set(p.handle, p.metadata.catalog_id)
  }

  // Chỉ xét sản phẩm đang có trong DB; sản phẩm của catalog chưa được seed thì bỏ qua.
  const { data: dbProducts } = await query.graph({ entity: "product", fields: ["id", "handle", "thumbnail"] })

  let hadThumbnail = 0
  let missingFile = 0
  const todo: { id: string; catalogId: string }[] = []
  for (const product of dbProducts as { id: string; handle: string; thumbnail: string | null }[]) {
    const catalogId = catalogIdByHandle.get(product.handle)
    if (!catalogId) continue
    if (product.thumbnail) {
      hadThumbnail++
    } else if (!existsSync(join(imagesDir, `${catalogId}.webp`))) {
      missingFile++
    } else {
      todo.push({ id: product.id, catalogId })
    }
  }

  let attached = 0
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE)

    // Kết quả upload trả về theo đúng thứ tự file đầu vào.
    const { result: uploaded } = await uploadFilesWorkflow(container).run({
      input: {
        files: batch.map(({ catalogId }) => ({
          filename: `${catalogId}.webp`,
          mimeType: "image/webp",
          content: readFileSync(join(imagesDir, `${catalogId}.webp`)).toString("base64"),
          access: "public" as const,
        })),
      },
    })

    await updateProductsWorkflow(container).run({
      input: {
        products: batch.map(({ id }, i) => ({
          id,
          thumbnail: uploaded[i].url,
          images: [{ url: uploaded[i].url }],
        })),
      },
    })
    attached += batch.length
  }

  return { attached, hadThumbnail, missingFile }
}
