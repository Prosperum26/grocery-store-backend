import type { AiSuggestResponse, StoreAiSuggestResponse, StoreSuggestion, StoreVariantInfo } from "../../types/ai"
import { attachBasket, catalogIdsOfBaskets } from "./attach-variants"

// Gắn phần bán hàng vào món gợi ý và bỏ món không mua được ngay. Hàm thuần, không đụng DB (như attach-variants.ts).

/** Mọi catalog_id trong các giỏ của kết quả gợi ý, không trùng. */
export function catalogIdsOfSuggestions(data: AiSuggestResponse): string[] {
  return catalogIdsOfBaskets(data.suggestions.map((s) => s.basket))
}

/**
 * Giữ món mà MỌI dòng còn phải mua (`buy`) đều có biến thể đã mở bán và còn hàng; món khác bị loại, không hiện "hết hàng".
 * Giữ thứ tự của AI service, cắt còn `keep` món. `missing_total` = tổng giá phần còn thiếu (đơn giá x số lượng mặc định).
 * Không còn món nào thì `status: "empty"`.
 */
export function shapeSuggestions(data: AiSuggestResponse, info: Map<string, StoreVariantInfo>, keep: number): StoreAiSuggestResponse {
  const kept: StoreSuggestion[] = []
  for (const suggestion of data.suggestions) {
    const basket = attachBasket(suggestion.basket, info)
    if (!basket.buy.every((item) => item.variant?.purchasable)) {
      continue
    }
    const missing_total = basket.buy.reduce((sum, item) => sum + (item.variant?.unit_price ?? 0) * item.default_qty, 0)
    kept.push({ ...suggestion, basket, missing_total })
    if (kept.length === keep) {
      break
    }
  }
  return { status: kept.length ? "ready" : "empty", suggestions: kept }
}
