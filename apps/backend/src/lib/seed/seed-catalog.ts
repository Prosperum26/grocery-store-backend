import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createPriceListsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { CatalogVariant, DEMO_CATALOG, SeedCatalogData } from "./seed-data/catalog"

const OPTION_TITLE = "Quy cách"
const PRICE_LIST_TITLE = "Khuyến mãi tuần"
// Tạo sản phẩm và tồn kho theo lô, để catalog 2.129 món không dồn vào một workflow quá lớn.
const BATCH_SIZE = 100

export type CatalogContext = {
  regionId: string
  salesChannelId: string
  stockLocationId: string
}

/**
 * Seed danh mục, sản phẩm, tồn kho tại Kho Q.7 và price list khuyến mãi.
 * Idempotent theo `handle`: sản phẩm đã có thì bỏ qua (không sửa lại giá/tồn).
 * Giá VND là số nguyên đồng.
 * `catalog` mặc định là bộ 32 món dùng cho test; `npm run seed` truyền catalog v2 (loadCatalogV2).
 */
export async function seedCatalog(
  container: MedusaContainer,
  ctx: CatalogContext,
  catalog: SeedCatalogData = DEMO_CATALOG
): Promise<{ created: number; skipped: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Danh mục: tạo cái còn thiếu theo handle
  const { data: existingCats } = await query.graph({ entity: "product_category", fields: ["id", "handle"] })
  const categoryIds = new Map<string, string>(existingCats.map((c: any) => [c.handle, c.id]))
  const missingCats = catalog.categories.filter((c) => !categoryIds.has(c.handle))
  if (missingCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missingCats.map((c) => ({ name: c.name, handle: c.handle, is_active: true })) },
    })
    result.forEach((c: any) => categoryIds.set(c.handle, c.id))
  }

  // 2. Sản phẩm mới (chưa có handle)
  const { data: existingProducts } = await query.graph({ entity: "product", fields: ["handle"] })
  const existingHandles = new Set(existingProducts.map((p: any) => p.handle))
  const toCreate = catalog.products.filter((p) => !existingHandles.has(p.handle))
  const skipped = catalog.products.length - toCreate.length
  if (!toCreate.length) {
    return { created: 0, skipped }
  }

  // Sản phẩm phải cùng shipping profile với shipping option thì mới giao được.
  const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] })
  const shippingProfileId = profiles[0]?.id
  if (!shippingProfileId) {
    throw new Error("Chưa có shipping profile; chạy bootstrapStore trước seedCatalog.")
  }

  // 3. Mỗi lô: tạo sản phẩm, rồi tra biến thể vừa tạo theo sku và đặt tồn tại Kho Q.7.
  const variants: (CatalogVariant & { productHandle: string })[] = []
  const bySku = new Map<string, any>()
  for (let start = 0; start < toCreate.length; start += BATCH_SIZE) {
    const batch = toCreate.slice(start, start + BATCH_SIZE)

    await createProductsWorkflow(container).run({
      input: {
        products: batch.map((p) => ({
          title: p.title,
          handle: p.handle,
          description: p.description,
          // Sản phẩm ẩn (combo, bản trùng) vẫn nằm trong DB để AI tra theo sku, nhưng là draft
          // nên Store API và /store/search (chỉ lấy published) không trả về.
          status: p.status === "draft" ? ProductStatus.DRAFT : ProductStatus.PUBLISHED,
          category_ids: [categoryIds.get(p.categoryHandle)!],
          shipping_profile_id: shippingProfileId,
          sales_channels: [{ id: ctx.salesChannelId }],
          metadata: p.metadata,
          options: [{ title: OPTION_TITLE, values: p.variants.map((v) => v.title) }],
          variants: p.variants.map((v) => ({
            title: v.title,
            sku: v.sku,
            manage_inventory: true,
            weight: v.weightGrams,
            options: { [OPTION_TITLE]: v.title },
            metadata: { is_default: v.isDefault === true },
            prices: [{ amount: v.priceVnd, currency_code: "vnd" }],
          })),
        })),
      },
    })

    const batchVariants = batch.flatMap((p) => p.variants.map((v) => ({ ...v, productHandle: p.handle })))
    const { data: createdVariants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "product.handle", "inventory_items.inventory_item_id"],
      filters: { sku: batchVariants.map((v) => v.sku) },
    })
    createdVariants.forEach((v: any) => bySku.set(v.sku, v))

    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: batchVariants.map((v) => ({
          inventory_item_id: bySku.get(v.sku).inventory_items[0].inventory_item_id,
          location_id: ctx.stockLocationId,
          stocked_quantity: v.stock,
        })),
      },
    })
    variants.push(...batchVariants)
  }

  // 4. Price list khuyến mãi cho biến thể có salePriceVnd
  const { data: existingLists } = await query.graph({
    entity: "price_list",
    fields: ["id"],
    filters: { title: PRICE_LIST_TITLE },
  })
  const saleVariants = variants.filter((v) => v.salePriceVnd !== undefined)
  if (!existingLists.length && saleVariants.length) {
    await createPriceListsWorkflow(container).run({
      input: {
        price_lists_data: [
          {
            title: PRICE_LIST_TITLE,
            description: "Giá khuyến mãi trong tuần",
            status: "active" as any,
            prices: saleVariants.map((v) => ({
              variant_id: bySku.get(v.sku).id,
              amount: v.salePriceVnd!,
              currency_code: "vnd",
            })),
          },
        ],
      },
    })

    // Price list không phát event nào, nên index tìm kiếm không biết giá đã đổi (V15).
    // Phát product.updated cho các sản phẩm bị ảnh hưởng để index làm mới.
    const eventBus = container.resolve(Modules.EVENT_BUS)
    const affected = [...new Set(saleVariants.map((v) => bySku.get(v.sku).product.handle))]
    const { data: affectedProducts } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { handle: affected },
    })
    await eventBus.emit(affectedProducts.map((p: any) => ({ name: "product.updated", data: { id: p.id } })))
  }

  return { created: toCreate.length, skipped }
}
