import type {
  AiBasket,
  AiBasketItem,
  AiSearchResponse,
  StoreAlternative,
  StoreBasket,
  StoreBasketItem,
  StoreVariantInfo,
} from "../../types/ai"

// Gắn phần bán hàng của Medusa (biến thể, giá, tồn) vào kết quả của AI service. Hàm thuần, không đụng DB:
// workflow ai-recipe-search đọc dữ liệu rồi gọi các hàm này. Hợp đồng: docs/contracts/ai-copilot.md, mục 3.

const itemsOf = (basket: AiBasket): AiBasketItem[] => [...basket.buy, ...basket.maybe_have]

/** Mọi catalog_id xuất hiện trong kết quả (sản phẩm chính và phương án thay thế), không trùng, giữ thứ tự gặp. */
export function catalogIdsOf(data: AiSearchResponse): string[] {
  return catalogIdsOfBaskets(data.results.map((result) => result.basket))
}

export function catalogIdsOfBaskets(baskets: AiBasket[]): string[] {
  const ids = new Set<string>()
  for (const basket of baskets) {
    for (const item of itemsOf(basket)) {
      ids.add(item.product.catalog_id)
      item.alternatives.forEach((alt) => ids.add(alt.catalog_id))
    }
  }
  return [...ids]
}

/** Một dòng biến thể đọc từ Medusa (qua query.graph), chưa có tồn. */
export type VariantRow = {
  id: string
  sku: string
  title: string
  product: { id: string; handle: string; title: string; status: string }
  calculated_price?: { calculated_amount?: number | null } | null
}

/** Tồn đã trừ phần đang giữ (API-15); null = biến thể không quản kho. Thiếu mục nào thì coi là hết hàng. */
export type StockOf = (variantId: string) => number | null | undefined

/**
 * catalog_id -> StoreVariantInfo. Sản phẩm chưa mở bán (draft) không có trong kết quả, nên storefront nhận
 * `variant: null` và chỉ hiện tên. Sản phẩm không quản kho coi là không giới hạn (cùng quy ước với availableOf).
 */
export function buildVariantInfo(rows: VariantRow[], stockOf: StockOf): Map<string, StoreVariantInfo> {
  const bySku = new Map<string, StoreVariantInfo>()
  for (const row of rows) {
    if (row.product.status !== "published") {
      continue
    }
    const stock = stockOf(row.id)
    const available = stock === null ? Number.MAX_SAFE_INTEGER : Math.max(0, stock ?? 0)
    bySku.set(row.sku, {
      variant_id: row.id,
      product_id: row.product.id,
      handle: row.product.handle,
      title: row.product.title,
      unit_label: row.title,
      unit_price: Number(row.calculated_price?.calculated_amount ?? 0),
      available,
      purchasable: available > 0,
    })
  }
  return bySku
}

function attachItem(item: AiBasketItem, info: Map<string, StoreVariantInfo>): StoreBasketItem {
  return {
    ...item,
    variant: info.get(item.product.catalog_id) ?? null,
    alternatives: item.alternatives.map((alt): StoreAlternative => ({ ...alt, variant: info.get(alt.catalog_id) ?? null })),
  }
}

/** Gắn `variant` cho một giỏ (màn công thức dùng trực tiếp). */
export function attachBasket(basket: AiBasket, info: Map<string, StoreVariantInfo>): StoreBasket {
  return { buy: basket.buy.map((item) => attachItem(item, info)), maybe_have: basket.maybe_have.map((item) => attachItem(item, info)) }
}

/** Trả bản sao có `variant` ở từng dòng giỏ và từng phương án thay thế; mọi trường khác của AI giữ nguyên. */
export function attachVariants(data: AiSearchResponse, info: Map<string, StoreVariantInfo>): AiSearchResponse<StoreBasket> {
  return {
    ...data,
    results: data.results.map((result) => ({
      ...result,
      basket: attachBasket(result.basket, info),
    })),
  }
}
