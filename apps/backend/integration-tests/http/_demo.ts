import { CATALOG } from "../../src/lib/seed/seed-data/catalog"
import type { DemoData } from "../../src/lib/seed/seed-data/demo"

// Test chạy trên bộ 32 món, nên thay sku catalog v2 của đơn demo bằng sku của bộ 32 món còn nhiều hàng.
// Cùng một sku v2 luôn đổi sang cùng một sku, nên món lặp lại giữa các đơn vẫn lặp lại.
// `skuOf` cho biết sku v2 đã đổi thành sku nào.
export function withFixtureSkus(data: DemoData): { data: DemoData; skuOf: (v2Sku: string) => string } {
  const pool = CATALOG.flatMap((p) => p.variants).filter((v) => v.stock >= 20).map((v) => v.sku)
  const v2Skus = [...new Set(data.orders.flatMap((o) => o.items.map((i) => i.sku)))]
  const map = new Map(v2Skus.map((sku, i) => [sku, pool[i % pool.length]]))
  return {
    data: {
      ...data,
      orders: data.orders.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, sku: map.get(i.sku)! })) })),
    },
    skuOf: (v2Sku) => map.get(v2Sku)!,
  }
}
