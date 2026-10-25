import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createPriceListsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { CATALOG, CATEGORIES } from "./seed-data/catalog"

const OPTION_TITLE = "Quy cách"
const PRICE_LIST_TITLE = "Khuyến mãi tuần"

export type CatalogContext = {
  regionId: string
  salesChannelId: string
  stockLocationId: string
}

/**
 * Seed danh mục, sản phẩm, tồn kho tại Kho Q.7 và price list khuyến mãi.
 * Idempotent theo `handle`: sản phẩm đã có thì bỏ qua (không sửa lại giá/tồn).
 * Giá VND là số nguyên đồng.
 */
export async function seedCatalog(
  container: MedusaContainer,
  ctx: CatalogContext
): Promise<{ created: number; skipped: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Danh mục: tạo cái còn thiếu theo handle
  const { data: existingCats } = await query.graph({ entity: "product_category", fields: ["id", "handle"] })
  const categoryIds = new Map<string, string>(existingCats.map((c: any) => [c.handle, c.id]))
  const missingCats = CATEGORIES.filter((c) => !categoryIds.has(c.handle))
  if (missingCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missingCats.map((c) => ({ name: c.name, handle: c.handle, is_active: true })) },
    })
    result.forEach((c: any) => categoryIds.set(c.handle, c.id))
  }

  // 2. Sản phẩm mới (chưa có handle)
  const { data: existingProducts } = await query.graph({ entity: "product", fields: ["handle"] })
  const existingHandles = new Set(existingProducts.map((p: any) => p.handle))
  const toCreate = CATALOG.filter((p) => !existingHandles.has(p.handle))
  const skipped = CATALOG.length - toCreate.length
  if (!toCreate.length) {
    return { created: 0, skipped }
  }

  // Sản phẩm phải cùng shipping profile với shipping option thì mới giao được.
  const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] })
  const shippingProfileId = profiles[0]?.id
  if (!shippingProfileId) {
    throw new Error("Chưa có shipping profile; chạy bootstrapStore trước seedCatalog.")
  }

  await createProductsWorkflow(container).run({
    input: {
      products: toCreate.map((p) => ({
        title: p.title,
        handle: p.handle,
        description: p.description,
        status: ProductStatus.PUBLISHED,
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

  // 3. Tồn kho tại Kho Q.7: tra id biến thể và inventory item theo sku
  const variants = toCreate.flatMap((p) => p.variants.map((v) => ({ ...v, productHandle: p.handle })))
  const { data: createdVariants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product.handle", "inventory_items.inventory_item_id"],
    filters: { sku: variants.map((v) => v.sku) },
  })
  const bySku = new Map<string, any>(createdVariants.map((v: any) => [v.sku, v]))

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: variants.map((v) => ({
        inventory_item_id: bySku.get(v.sku).inventory_items[0].inventory_item_id,
        location_id: ctx.stockLocationId,
        stocked_quantity: v.stock,
      })),
    },
  })

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
