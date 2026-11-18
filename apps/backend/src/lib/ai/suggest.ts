import type { AiSuggestResponse, StoreAiSuggestResponse, StoreSuggestion, StoreVariantInfo } from "../../types/ai"
import { attachBasket, catalogIdsOfBaskets } from "./attach-variants"

/** Số gói một dòng thêm vào giỏ: cùng quy tắc với packsOf() của storefront (lib/util/kitchen.ts). */
const packsOf = (item: { pack_hint: number | null; default_qty: number }) => Math.max(1, Math.round(item.pack_hint ?? item.default_qty ?? 1))

// Gắn phần bán hàng vào món gợi ý và bỏ món không mua được ngay. Hàm thuần, không đụng DB (như attach-variants.ts).

/** Mọi catalog_id trong các giỏ của kết quả gợi ý, không trùng. */
export function catalogIdsOfSuggestions(data: AiSuggestResponse): string[] {
  return catalogIdsOfBaskets(data.suggestions.map((s) => s.basket))
}

/**
 * Giữ món mà MỌI dòng còn phải mua (`buy`) đều có biến thể đã mở bán và còn hàng; món khác bị loại, không hiện "hết hàng".
 * Giữ thứ tự của AI service, cắt còn `keep` món. `missing_total` = tổng giá phần còn thiếu, tính số gói như nút "Thêm" của
 * storefront (gợi ý `pack_hint`, không có thì `default_qty`, tối thiểu 1) để số tiền trên thẻ khớp với giỏ.
 * Không còn món nào thì `status: "empty"`.
 */
export function shapeSuggestions(data: AiSuggestResponse, info: Map<string, StoreVariantInfo>, keep: number): StoreAiSuggestResponse {
  const kept: StoreSuggestion[] = []
  for (const suggestion of data.suggestions) {
    const basket = attachBasket(suggestion.basket, info)
    if (!basket.buy.every((item) => item.variant?.purchasable)) {
      continue
    }
    const missing_total = basket.buy.reduce((sum, item) => sum + (item.variant?.unit_price ?? 0) * packsOf(item), 0)
    kept.push({ ...suggestion, basket, missing_total })
    if (kept.length === keep) {
      break
    }
  }
  return { status: kept.length ? "ready" : "empty", suggestions: kept }
}

/** Ngày theo giờ Việt Nam (UTC+7), dạng 2026-11-13: đổi lúc nửa đêm giờ Việt Nam, không phải nửa đêm UTC. */
export const vietnamDay = (now: Date): string => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)

/** Hạt giống của A: cùng khách, cùng ngày thì thấy cùng món; khách chưa đăng nhập dùng chung "guest". */
export const discoverSeed = (customerId: string | undefined, now: Date): string => `${customerId ?? "guest"}:${vietnamDay(now)}`
