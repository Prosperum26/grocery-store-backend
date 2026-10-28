// Hợp đồng dữ liệu của Trợ lý Bếp và Công thức vào giỏ (BE-10, API-8). FE sao chép các kiểu này.
// Giải thích và ví dụ JSON: docs/contracts/assistant-recipes.md.
// Quy tắc "chỉ hiện điều chắc chắn": không có điểm khớp, xác suất, nguồn dữ liệu, thời gian trả lời, kcal.

/**
 * Vai trò của nguyên liệu trong món, lấy từ dữ liệu công thức (recipes_v2.json):
 * - core: nguyên liệu chính, phải có mới nấu được;
 * - side: rau nêm, món ăn kèm;
 * - addon: gia vị nêm (muối, đường, nước mắm...), thường nhà đã có nên mặc định không mua.
 */
export type IngredientKind = "core" | "side" | "addon"

/** Một sản phẩm thay thế cho cùng nguyên liệu (khác hãng hoặc khác quy cách). */
export type RecipeAlternative = {
  catalog_id: string // = sku của biến thể, mã mà AI dùng
  variant_id: string
  title: string
  unit_label: string // tên biến thể, ví dụ "Khay 500g"
  unit_price: number // VND, giá đang tính (gồm khuyến mãi)
  in_stock: boolean
}

/**
 * Một dòng trong giỏ nguyên liệu. Mỗi biến thể xuất hiện tối đa một lần trong một giỏ: hai nguyên liệu
 * cùng trỏ về một sản phẩm (rau om, ngò gai -> "Rau om, ngò gai") được gộp, `need_text` nối bằng "; ".
 */
export type RecipeIngredient = {
  need_text: string // dòng nguyên liệu gốc của công thức, ví dụ "Giá: 100g"
  kind: IngredientKind
  catalog_id: string
  variant_id: string // phương án chọn sẵn: phương án đầu tiên còn hàng
  title: string
  unit_label: string
  quantity: number // số gói cần mua, số nguyên >= 1, đã làm tròn lên (mua dư) theo khẩu phần yêu cầu
  unit_price: number
  in_stock: boolean
  alternatives?: RecipeAlternative[] // các phương án khác, theo thứ tự ưu tiên; không có thì bỏ trống
}

export type Recipe = {
  slug: string // id công thức trong recipes_v2.json, ví dụ "canh-chua-ca-loc"
  name: string
  serves: number // khẩu phần đã dùng để tính quantity
  time_minutes: number
  steps: string[] // sơ chế rồi nấu, theo thứ tự
  ingredients: RecipeIngredient[]
  // Tổng tiền các dòng core và side còn hàng: số tiền của nút "Thêm vào giỏ". Dòng addon không tính.
  buy_total: number
}

/** Thực đơn nhiều bữa. Nguyên liệu dùng chung giữa các món chỉ mua một lần trong `basket`. */
export type MealPlan = {
  meals: {
    day: string // nhãn hiển thị, ví dụ "T5"
    dish: string
    recipe_slug: string
    need_variant_ids: string[] // các dòng của basket mà món này dùng
  }[]
  basket: {
    items: RecipeIngredient[]
    total: number // cùng quy tắc với buy_total
  }
}

/** Câu trả lời của trợ lý: luôn có `text`, kèm tối đa một công thức hoặc một thực đơn. */
export type AssistantReply = {
  text: string
  recipe?: Recipe
  plan?: MealPlan
}

// ---- Request

/** POST /store/recipes/semantic-search */
export type RecipeSearchRequest = {
  query: string // tên món hoặc mô tả, 1–200 ký tự
  servings?: number // 1–20; bỏ trống thì dùng khẩu phần gốc của công thức
  limit?: number // 1–10, mặc định 3
}

/** Response của POST /store/recipes/semantic-search: các món theo thứ tự liên quan, không kèm điểm. */
export type RecipeSearchResponse = { recipes: Recipe[] }

/** POST /store/assistant/chat */
export type AssistantChatRequest = {
  message: string // 1–1000 ký tự
  history?: { role: "user" | "assistant"; text: string }[] // tối đa 20 lượt gần nhất
  cart_id?: string // giỏ của khách; tool add_to_cart chỉ được thêm vào giỏ này
}
