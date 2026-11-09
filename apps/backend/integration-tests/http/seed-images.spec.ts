import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { bootstrapStore } from "../../src/lib/seed/bootstrap-store"
import { seedCatalog } from "../../src/lib/seed/seed-catalog"
import { attachCatalogImages } from "../../src/lib/seed/upload-images"
import { DEMO_CATALOG, SeedCatalogData } from "../../src/lib/seed/seed-data/catalog"

jest.setTimeout(180 * 1000)

// WebP 1x1 hợp lệ, đủ để upload; test không cần ảnh thật.
const WEBP_1X1 = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")

// Ba sản phẩm đầu của bộ demo được gán catalog_id như catalog v2.
const CATALOG: SeedCatalogData = {
  categories: DEMO_CATALOG.categories,
  products: DEMO_CATALOG.products.map((p, i) =>
    i < 3 ? { ...p, metadata: { ...p.metadata, catalog_id: `CAT-T${i + 1}` } } : p
  ),
}
const HANDLES = CATALOG.products.slice(0, 3).map((p) => p.handle)
const NO_URLS = new Map<string, string>()

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("attachCatalogImages", () => {
      let imagesDir: string

      beforeEach(async () => {
        const container = getContainer()
        const store = await bootstrapStore(container)
        await seedCatalog(container, store, CATALOG)
        // Chỉ T1 và T2 có file ảnh; T3 thì không.
        imagesDir = mkdtempSync(join(tmpdir(), "seed-images-"))
        writeFileSync(join(imagesDir, "CAT-T1.webp"), WEBP_1X1)
        writeFileSync(join(imagesDir, "CAT-T2.webp"), WEBP_1X1)
      })

      afterEach(() => {
        rmSync(imagesDir, { recursive: true, force: true })
      })

      const readProducts = async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "product",
          fields: ["handle", "thumbnail", "images.url"],
          filters: { handle: HANDLES },
        })
        return new Map<string, any>(data.map((p: any) => [p.handle, p]))
      }

      it("attaches thumbnail and images to products that have a file", async () => {
        const result = await attachCatalogImages(getContainer(), CATALOG, imagesDir, NO_URLS)
        expect(result).toEqual({ uploaded: 2, linked: 0, hadThumbnail: 0, missing: 1 })

        const products = await readProducts()
        for (const handle of HANDLES.slice(0, 2)) {
          const p = products.get(handle)
          expect(p.thumbnail).toMatch(/\/static\/.*\.webp$/)
          expect(p.images.length).toBeGreaterThanOrEqual(1)
        }
        expect(products.get(HANDLES[2]).thumbnail).toBeNull()
      })

      it("is idempotent: a second run adds no images", async () => {
        await attachCatalogImages(getContainer(), CATALOG, imagesDir, NO_URLS)
        const before = await readProducts()

        const second = await attachCatalogImages(getContainer(), CATALOG, imagesDir, NO_URLS)
        expect(second).toEqual({ uploaded: 0, linked: 0, hadThumbnail: 2, missing: 1 })

        const after = await readProducts()
        for (const handle of HANDLES) {
          expect(after.get(handle).thumbnail).toBe(before.get(handle).thumbnail)
          expect(after.get(handle).images).toHaveLength(before.get(handle).images.length)
        }
      })

      it("does nothing when the images folder does not exist", async () => {
        const result = await attachCatalogImages(getContainer(), CATALOG, join(imagesDir, "khong-ton-tai"), NO_URLS)
        expect(result).toEqual({ uploaded: 0, linked: 0, hadThumbnail: 0, missing: 3 })
      })

      it("ignores catalog products that are not in the database", async () => {
        writeFileSync(join(imagesDir, "CAT-T9.webp"), WEBP_1X1)
        const withGhost: SeedCatalogData = {
          ...CATALOG,
          products: [
            ...CATALOG.products,
            { ...CATALOG.products[0], handle: "chua-seed", metadata: { ...CATALOG.products[0].metadata, catalog_id: "CAT-T9" } },
          ],
        }
        const result = await attachCatalogImages(getContainer(), withGhost, imagesDir, NO_URLS)
        expect(result).toEqual({ uploaded: 2, linked: 0, hadThumbnail: 0, missing: 1 })
      })

      it("links the original image URL when there is no local file, preferring the file", async () => {
        const urls = new Map([
          ["CAT-T2", "https://cdn.example/t2.jpg"],
          ["CAT-T3", "https://cdn.example/t3.jpg"],
        ])
        const result = await attachCatalogImages(getContainer(), CATALOG, imagesDir, urls)
        expect(result).toEqual({ uploaded: 2, linked: 1, hadThumbnail: 0, missing: 0 })

        const products = await readProducts()
        // T2 có cả file lẫn link: dùng file đã upload.
        expect(products.get(HANDLES[1]).thumbnail).toMatch(/\/static\/.*\.webp$/)
        // T3 chỉ có link: ghi thẳng link gốc.
        expect(products.get(HANDLES[2]).thumbnail).toBe("https://cdn.example/t3.jpg")
        expect(products.get(HANDLES[2]).images.map((i: any) => i.url)).toEqual(["https://cdn.example/t3.jpg"])

        const second = await attachCatalogImages(getContainer(), CATALOG, imagesDir, urls)
        expect(second).toEqual({ uploaded: 0, linked: 0, hadThumbnail: 3, missing: 0 })
      })
    })
  },
})
