/**
 * Hợp đồng dữ liệu của 2 AI (task AI-0, 2026-11-06). CHỈ là kiểu dữ liệu: backend chưa gọi AI service.
 * Giải thích và ví dụ: docs/contracts/ai-service.md (backend ↔ AI service) và docs/contracts/ai-copilot.md
 * (storefront ↔ backend). Thay hợp đồng BE-10 cũ (src/types/assistant.ts, đã bỏ).
 *
 * Hai lớp:
 * - `Ai*`  : JSON thô của AI service (`grocery-store-ai`), nhóm AI giữ. Chỉ biết `catalog_id`.
 * - `Store*`: JSON backend trả storefront: giữ nguyên dữ liệu AI, gắn thêm phần bán hàng của Medusa
 *   (biến thể, giá, tồn, mua được không) vào từng sản phẩm.
 */

// ---------------------------------------------------------------------------------------------------------
// AI #2 Trợ lý Bếp: backend ↔ AI service (POST /api/v1/search, POST /api/v1/copilot)
// Theo docs/recipe_rag/plan-ai-copilot.md mục 3 của repo AI (nhánh feature/recipe-rag-copilot, 2026-11-05).
// ---------------------------------------------------------------------------------------------------------

export type AiSearchRequest = {
  query: string // 1–300 ký tự, ví dụ "canh chua cá lóc cho 4 người"
  servings?: number // 1–50; bỏ trống thì AI đọc từ câu hỏi
  top_k?: number // 1–10, mặc định 5
  have?: string[] // tên nguyên liệu hoặc catalog_id khách đã có
  include_basket?: boolean // false: chỉ cần danh sách món (màn tìm kiếm), giỏ trả về rỗng. Mặc định true
}

export type AiNeed = { quantity: number; unit: string | null; scaled_for: number }

export type AiProduct = {
  catalog_id: string // = sku của biến thể trong Medusa (BE-2)
  name: string
  category: string | null
  pack_size: number | null
  pack_unit: string | null
}

export type AiAlternative = { catalog_id: string; name: string }

export type AiBasketItem = {
  ingredient: string // tên hiển thị; nhiều nguyên liệu chung một sản phẩm thì nối bằng ", "
  ingredients?: string[] // từng nguyên liệu mà sản phẩm này phục vụ (thường chỉ một). Mỗi sản phẩm chỉ có một dòng trong giỏ
  kind: "core" | "addon"
  raw_text: string // dòng nguyên liệu gốc của công thức
  need: AiNeed | null // null khi công thức không ghi lượng
  product: AiProduct
  derived: boolean // true: tự làm từ sản phẩm này (nước me từ me), không bán sẵn
  default_qty: number // 1 ở `buy`, 0 ở `maybe_have`
  pack_hint: number | null // số gói gợi ý, chỉ khi lượng cần và quy cách cùng loại đơn vị
  alternatives: AiAlternative[]
}

export type AiBasket = { buy: AiBasketItem[]; maybe_have: AiBasketItem[] }

export type AiRecipeInfo = {
  id: string
  name: string
  family: string | null
  servings: number
  time_minutes: number | null
  difficulty: string | null
  description: string | null
  image_url: string | null
  source_url: string
}

export type AiSearchResult<Basket = AiBasket> = {
  recipe: AiRecipeInfo
  score: number // cosine bge-m3 của thẻ món (0 nếu chỉ khớp từ khóa)
  matched_by: "keyword" | "semantic" | "both"
  complete: boolean
  basket: Basket
}

export type AiSearchResponse<Basket = AiBasket> = {
  request_id?: string
  query: string
  servings: number
  accepted: boolean // false: không có món đủ gần, results là món gần nhất ("chưa có món đúng ý")
  threshold: number
  results: AiSearchResult<Basket>[]
}

export type AiCopilotStatus = "ok" | "skipped_no_match" | "fallback_disabled" | "fallback_invalid" | "fallback_timeout" | "fallback_error"

export type AiCopilotAnswer = {
  provider: string
  model: string
  recipe_id: string // một trong các món của data.results
  explanation: string
  item_notes: { ingredient: string; note: string }[]
  prep_notes: { ingredient: string; steps: string[] }[] // ingredient là nguyên liệu derived
  follow_up_question: string | null
}

export type AiCopilotResponse<Basket = AiBasket> = {
  data: AiSearchResponse<Basket> // luôn có, do code dựng
  ai: AiCopilotAnswer | null // null khi lớp lời AI lỗi, tắt hoặc không cần
  ai_status: AiCopilotStatus
  latency_ms: number
}

// ---------------------------------------------------------------------------------------------------------
// AI #2 Trợ lý Bếp: storefront ↔ backend (POST /store/ai/search, POST /store/ai/copilot), API-8
// ---------------------------------------------------------------------------------------------------------

/** Body của /store/ai/search và /store/ai/copilot: giống AiSearchRequest. */
export type StoreAiSearchRequest = AiSearchRequest

/**
 * Phần bán hàng backend gắn vào một catalog_id. null khi catalog_id không có biến thể bán được trong Medusa
 * (không có hoặc sản phẩm đang ẩn); storefront khi đó hiện tên sản phẩm nhưng không cho thêm vào giỏ.
 */
export type StoreVariantInfo = {
  thumbnail: string | null // ảnh sản phẩm, để thẻ gợi ý vẽ dải ảnh nguyên liệu
  variant_id: string
  product_id: string
  handle: string // để mở trang sản phẩm
  title: string // tên sản phẩm trong Medusa
  unit_label: string // tên biến thể, ví dụ "Khay 500g"
  unit_price: number // VND, giá đang tính (gồm khuyến mãi)
  available: number // tồn đã trừ phần khách khác đang giữ (như API-15)
  purchasable: boolean // false khi hết hàng
}

export type StoreAlternative = AiAlternative & { variant: StoreVariantInfo | null }

export type StoreBasketItem = Omit<AiBasketItem, "alternatives"> & {
  variant: StoreVariantInfo | null // của product.catalog_id
  alternatives: StoreAlternative[]
}

export type StoreBasket = { buy: StoreBasketItem[]; maybe_have: StoreBasketItem[] }

export type StoreAiSearchResponse = AiSearchResponse<StoreBasket>

export type StoreAiCopilotResponse = AiCopilotResponse<StoreBasket>

// ---------------------------------------------------------------------------------------------------------
// AI #2 Trợ lý Bếp, màn công thức: POST /api/v1/recipe (không gọi mô hình, nhanh) và POST /api/v1/ask (khách bấm hỏi thêm)
// Storefront gọi qua POST /store/ai/recipe và POST /store/ai/ask.
// ---------------------------------------------------------------------------------------------------------

export type AiRecipeRequest = {
  recipe_id: string // AiRecipeInfo.id
  servings?: number // 1–50; bỏ trống thì lấy khẩu phần của công thức
  have?: string[] // như AiSearchRequest.have
}

export type AiRecipeDetail<Basket = AiBasket> = {
  recipe: AiRecipeInfo
  servings: number
  complete: boolean
  prep_steps: string[] // các bước chuẩn bị, lấy từ dữ liệu công thức đã thu thập
  cooking_steps: string[]
  basket: Basket
  ingredient_lines?: string[] // nguyên liệu đúng như công thức ghi, mỗi dòng một lần
  not_in_basket: string[] // phần không vào giỏ (đồ ăn kèm, không phải hàng mua): chữ công thức hoặc tên nguyên liệu
}

export type StoreAiRecipeResponse = AiRecipeDetail<StoreBasket>

export type AiAskRequest = {
  recipe_id: string
  question: string // 1–300 ký tự
  servings?: number
  history?: { question: string; answer: string }[] // tối đa 6 lượt trước, cũ trước mới sau, để hỏi nối tiếp
}

export type AiAskStatus = "ok" | "fallback_disabled" | "fallback_invalid" | "fallback_timeout" | "fallback_error"

export type AiAskResponse = {
  answer: string | null // null khi mô hình tắt, lỗi hoặc quá giờ: storefront báo "chưa trả lời được"
  status: AiAskStatus
  provider: string | null
  model: string | null
  latency_ms: number
}

// ---------------------------------------------------------------------------------------------------------
// AI #1 Dự đoán mua lại: backend ↔ AI service (POST /api/v1/predict)
// Theo src/schemas/reorder_dto.py của repo AI (nhánh feature/predictive-reorder, 2026-11-05).
// Storefront không đổi: vẫn là API-3 (src/workflows/get-reorder-basket.ts, ReorderBasket).
// ---------------------------------------------------------------------------------------------------------

export type AiPredictRequest = {
  orders: { placed_at: string; lines: { product_id: string; category: string | null }[] }[] // tối đa 500 đơn; placed_at ISO có múi giờ
  at?: string // thời điểm dự đoán, mặc định bây giờ
  top_k?: number // 1–15, mặc định 5; τ chỉ áp khi top_k = 15
  lot_expiry?: Record<string, string> // product_id -> hạn của lô (ISO), tuỳ chọn
}

export type AiPredictResponse = {
  status: "ready" | "empty"
  items: { product_id: string; score: number; rank: number }[]
  suppressed: { product_id: string; rule: "lot_expiring" | "not_due" }[]
  tau_applied: number | null
  low_history: boolean
  model_file: string
}

// ---------------------------------------------------------------------------------------------------------
// Gợi ý món (B giỏ hàng, C trang sản phẩm): POST /api/v1/suggest/by-products. Storefront gọi POST /store/ai/suggest/by-products.
// Spec: grocery-store-frontend/docs/plans/2026-11-11-recipe-suggestions-spec.md
// ---------------------------------------------------------------------------------------------------------

export type AiSuggestByProductsRequest = {
  catalog_ids: string[] // 1–30, sku của biến thể
  mode: "cart" | "product"
  limit?: number // 1–12
  have?: string[]
  exclude_ids?: string[]
}

export type AiSuggestion<Basket = AiBasket> = {
  recipe: AiRecipeInfo
  matched: { catalog_id: string; name: string }[] // sản phẩm đầu vào có trong món; name là tên nguyên liệu trong công thức
  new_count: number | null // chỉ ở discover
  familiar_count: number | null
  missing_count: number
  basket: Basket
}

export type AiSuggestResponse<Basket = AiBasket> = { suggestions: AiSuggestion<Basket>[] }

export type StoreSuggestion = AiSuggestion<StoreBasket> & { missing_total: number } // VND, tổng phần còn thiếu (buy)

export type StoreAiSuggestResponse = { status: "ready" | "empty"; suggestions: StoreSuggestion[] }

export type StoreAiSuggestByProductsRequest = {
  catalog_ids: string[]
  mode: "cart" | "product"
  limit?: number // 1–3
  exclude_ids?: string[]
}

// Thử món mới (A): POST /api/v1/suggest/discover. Storefront gọi POST /store/ai/suggest/discover.
export type AiDiscoverRequest = {
  bought_catalog_ids: string[] // sku trong các đơn đã giao của khách; rỗng = khách chưa có lịch sử
  have: string[]
  seed: string // khách + ngày: cùng khách cùng ngày thấy cùng món
  limit?: number // 1–12
  exclude_ids?: string[]
}

export type StoreAiDiscoverRequest = { exclude_ids?: string[]; have?: string[] }
