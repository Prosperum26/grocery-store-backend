# Hợp đồng Trợ lý Bếp và Công thức vào giỏ (BE-10, API-8)

Người đọc: nhóm AI (repo `grocery-store-ai`) và người làm storefront. Kiểu TypeScript ở `apps/backend/src/types/assistant.ts` là nguồn sự thật; FE sao chép nguyên các kiểu đó. Đổi hình dạng thì sửa cả file kiểu, file này và dòng API-8 trong `docs/plans/2026-10-18-sync-ui-v2-backend.md`.

## Trạng thái

Hai route đã có và **kiểm body theo hợp đồng**, nhưng chưa có AI phía sau: body đúng thì trả

```json
501 { "code": "IN_DEVELOPMENT", "type": "not_implemented", "message": "Đang trong quá trình phát triển" }
```

Body sai trả 400, thiếu `x-publishable-api-key` trả 400 như mọi route `/store/*`. Storefront nên coi 501 là trạng thái "đang phát triển" và hiện khối giữ chỗ. Khi nhóm AI nối vào, chỉ phần trả về đổi; request giữ nguyên.

## Route

| Route | Body | Trả về |
| :--- | :--- | :--- |
| `POST /store/recipes/semantic-search` | `{ query, servings?, limit? }` | `{ recipes: Recipe[] }`, theo thứ tự liên quan |
| `POST /store/assistant/chat` | `{ message, history?, cart_id? }` | `AssistantReply`: `{ text, recipe?, plan? }` |

Giới hạn body:
- `query`: 1–200 ký tự sau khi cắt khoảng trắng. `servings`: số nguyên 1–20, bỏ trống thì dùng khẩu phần gốc của công thức. `limit`: 1–10, mặc định 3.
- `message`: 1–1000 ký tự. `history`: tối đa 20 lượt, `role` chỉ là `user` hoặc `assistant` (không nhận `system`, tránh chèn lệnh qua lịch sử). `cart_id`: giỏ của khách; tool `add_to_cart` chỉ được thêm vào giỏ này.
- Chat trả **một JSON hoàn chỉnh**, chưa stream. Proposal ghi chat có streaming; nếu làm thì phần cuối của luồng vẫn là đúng `AssistantReply` này.

## Kiểu dữ liệu

```ts
type IngredientKind = "core" | "side" | "addon"

type RecipeIngredient = {
  need_text: string      // dòng nguyên liệu gốc, ví dụ "Giá: 100g"
  kind: IngredientKind
  catalog_id: string     // = sku, mã AI dùng
  variant_id: string     // phương án chọn sẵn
  title: string
  unit_label: string     // tên biến thể, ví dụ "Khay 500g"
  quantity: number       // số gói, nguyên >= 1, đã làm tròn lên
  unit_price: number     // VND, giá đang tính (gồm khuyến mãi)
  in_stock: boolean
  alternatives?: { catalog_id; variant_id; title; unit_label; unit_price; in_stock }[]
}

type Recipe = { slug; name; serves; time_minutes; steps: string[]; ingredients: RecipeIngredient[]; buy_total: number }

type MealPlan = {
  meals: { day: string; dish: string; recipe_slug: string; need_variant_ids: string[] }[]
  basket: { items: RecipeIngredient[]; total: number }
}

type AssistantReply = { text: string; recipe?: Recipe; plan?: MealPlan }
```

## Quy tắc

1. **Catalog là nguồn sự thật.** Mọi dòng trỏ tới một biến thể có thật, đang hiện (`status = published`). Sản phẩm ẩn (`tools/catalog/hidden-products.md`) không được chọn.
2. **Số lượng mua dư.** `quantity` là số gói, nguyên, ≥ 1: `packs = ⌈q' / s_v⌉` với `q' = q · servings / serves_gốc` (Eq. 3.8). Thiếu định lượng (ví dụ "Cà chua", không ghi số) thì 1 gói.
3. **Mỗi biến thể tối đa một dòng trong một giỏ.** Hai nguyên liệu cùng trỏ về một sản phẩm thì gộp, `need_text` nối bằng `"; "`. Trong thực đơn, nguyên liệu dùng chung giữa các món chỉ có một dòng trong `basket`; số lượng tính bằng cách **cộng lượng cần của các món rồi mới làm tròn theo gói** (cà chua cho hai món vẫn có thể chỉ 1 gói).
4. **Chọn sẵn phương án đầu tiên còn hàng.** `variant_id` là phương án đó; các phương án khác nằm trong `alternatives` theo thứ tự ưu tiên. Không còn phương án nào có hàng thì giữ phương án đầu với `in_stock: false`.
5. **`kind` lấy từ dữ liệu công thức.** `core` là nguyên liệu chính, `side` là rau nêm hoặc món ăn kèm, `addon` là gia vị nêm thường nhà đã có. Storefront mặc định không chọn dòng `addon`, khách tự tick nếu cần. Đây là thay thế cho thẻ "Nhà bạn đang có" (đã cắt khỏi MVP, câu hỏi O4).
6. **Tổng tiền** (`buy_total`, `basket.total`) = Σ `unit_price × quantity` của các dòng `core` và `side` còn hàng: đúng số tiền của nút "Thêm vào giỏ" khi chưa đổi lựa chọn nào.
7. **Chỉ hiện điều chắc chắn:** không có điểm khớp, xác suất, nguồn dữ liệu, thời gian trả lời, kcal.

## Chia việc giữa AI service và Medusa (đề xuất)

Theo `docs/05` (thư mục gốc), `check_stock` và `add_to_cart` chạy trong Medusa. Đề xuất:

- **AI service** trả công thức và giỏ theo `catalog_id`, cùng hình dạng `basket` của `recipes_v2.json`: `{ ingredient, kind, catalog_ids[], default_catalog_id, packs }` kèm `raw_text`.
- **Route Medusa** tra `catalog_id` → biến thể (sku), lấy giá đang tính và tồn kho, áp quy tắc 1, 3, 4, 6 rồi trả kiểu ở trên. Như vậy giá và tồn luôn lấy từ Medusa, AI không cần biết `variant_id`.

## Ví dụ

Sinh từ dữ liệu thật bằng `python tools/contracts/build_assistant_fixtures.py <thư mục data>`: công thức và giỏ của nhóm AI trong `recipes_v2.json`, giá và tồn của catalog v2. `variant_id` là giá trị giữ chỗ `variant_<catalog_id>` vì id thật khác nhau giữa các DB.

| File | Nội dung |
| :--- | :--- |
| `fixtures/recipe-search-response.json` | Kết quả tìm "canh chua cá lóc": 9 dòng `core`, 7 dòng `addon`, `buy_total` 126.700đ |
| `fixtures/assistant-reply-recipe.json` | Câu trả lời kèm một công thức |
| `fixtures/assistant-reply-plan.json` | Thực đơn 3 bữa (nấm đùi gà kho gừng, canh chua cá lóc, cải thìa xào nấm đông cô): 34 dòng, 9 dòng dùng chung giữa các món |

Trích một dòng:

```json
{
  "need_text": "Me vắt: 50g",
  "kind": "core",
  "catalog_id": "CAT-000953",
  "variant_id": "variant_CAT-000953",
  "title": "Me chua vắt gói 250g",
  "unit_label": "gói 250g",
  "quantity": 1,
  "unit_price": 5500,
  "in_stock": true,
  "alternatives": [{ "catalog_id": "CAT-001119", "variant_id": "variant_CAT-001119", "...": "..." }]
}
```

Số tiền không trùng số của thiết kế (canh chua 161.000đ, thực đơn 232.000đ) vì giá catalog v2 khác mock và công thức thật có nhiều nguyên liệu hơn.

## Điều thấy được từ dữ liệu thật (gửi nhóm AI)

- Giỏ của `canh-chua-ca-loc` có `rau om` và `ngò gai` cùng `CAT-001087`. Không gộp thì giỏ mua trùng (quy tắc 3).
- Một số dòng `raw_text` gộp nhiều nguyên liệu ("Rau om, ngò gai, ớt sừng", "Đường, muối, nước mắm, dầu ăn"), nên `need_text` của các dòng tách ra sẽ trùng nhau.
- Món chỉ có gia vị nêm ở `addon` thì `buy_total` không gồm chúng; nếu muốn tính, đổi quy tắc 6 ở cả hai phía.
- Giá catalog do `data/Price.py` ước lượng (ví dụ đường 500g 49.400đ), chưa phải giá thị trường.

## Câu hỏi còn mở

| # | Câu hỏi | Mặc định đang dùng |
| :--- | :--- | :--- |
| A1 | Gemini đặt ở Medusa (TypeScript) hay AI service (Python)? (Q1 ở `docs/06`) | Hợp đồng không đổi theo lựa chọn này |
| A2 | Chat có stream không? | Chưa; trả JSON hoàn chỉnh |
| A3 | Chat có bắt buộc đăng nhập không? | Không; khách vãng lai dùng `cart_id` của giỏ mình |
| A4 | Có hiện ảnh món không? `image_url` trong `recipes_v2.json` hiện là icon chung | Không có trường ảnh |
