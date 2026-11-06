# Hợp đồng storefront ↔ backend: Trợ lý Bếp (API-8)

> Task AI-0 (2026-11-06). **Thay hợp đồng BE-10 cũ** (`/store/recipes/semantic-search`, `/store/assistant/chat`, kiểu `Recipe`/`MealPlan`, đã bỏ): nhóm chọn theo hợp đồng của nhóm AI (`grocery-store-ai`, `docs/recipe_rag/plan-ai-copilot.md` mục 3) vì nhóm AI làm cả backend lẫn storefront của tính năng này, và dữ liệu của họ đã đo trên công thức thật (giỏ hai phần, ngưỡng "chưa có món đúng ý", lời AI có bản dự phòng). Storefront chưa gọi API-8 nên đổi không ảnh hưởng gì.
>
> Kiểu TypeScript: `apps/backend/src/types/ai.ts` (`StoreAi*`). Hợp đồng backend ↔ AI service: [`ai-service.md`](ai-service.md).

## 1. Endpoint

| Endpoint | Làm gì | Hiện trạng |
| :--- | :--- | :--- |
| `POST /store/ai/search` | Tìm món theo câu hỏi, trả giỏ nguyên liệu dựng sẵn. Nhanh (không dùng mô hình ngôn ngữ) | Giữ chỗ: kiểm body, trả `501 { code: "IN_DEVELOPMENT" }` |
| `POST /store/ai/copilot` | Như trên, kèm lời AI: giải thích, gợi ý lượng mua, hướng dẫn món phụ. Chậm hơn (vài giây) | Giữ chỗ: như trên |

- Cần `x-publishable-api-key` như mọi route `/store`. **Không bắt đăng nhập**: khách vãng lai cũng dùng được.
- Storefront có thể gọi `search` để hiện món ngay, rồi gọi `copilot` để bổ sung lời giải thích (plan AI, quyết định 3).

## 2. Request (cả hai endpoint)

```json
{ "query": "canh chua cá lóc cho 4 người", "servings": 4, "top_k": 5, "have": ["cà chua", "CAT-000939"] }
```

| Trường | Kiểu | Ràng buộc |
| :--- | :--- | :--- |
| `query` | string | bắt buộc, 1–300 ký tự sau khi cắt khoảng trắng |
| `servings` | number | tuỳ chọn, số nguyên 1–50; bỏ trống thì AI đọc từ câu hỏi ("cho 4 người") |
| `top_k` | number | tuỳ chọn, số nguyên 1–10, mặc định 5 |
| `have` | string[] | tuỳ chọn, tối đa 50; tên nguyên liệu hoặc `catalog_id` khách đã có |

Sai ràng buộc: `400` (kiểm ở `middlewares.ts`, test `integration-tests/http/ai-copilot.spec.ts`).

## 3. Response

`/store/ai/search` → `StoreAiSearchResponse`: y hệt `AiSearchResponse` của AI service, **mỗi dòng giỏ và mỗi phương án thay thế có thêm `variant`** do backend gắn:

```json
{ "query": "canh chua cá lóc", "servings": 4, "accepted": true, "threshold": 0.64,
  "results": [{
    "recipe": { "id": "canh-chua-ca-loc", "name": "Canh chua cá lóc", "family": "canh chua", "servings": 4,
                "time_minutes": 40, "difficulty": "dễ", "description": "...", "image_url": null, "source_url": "..." },
    "score": 0.71, "matched_by": "both", "complete": true,
    "basket": {
      "buy": [{
        "ingredient": "cá lóc", "kind": "core", "raw_text": "Cá lóc 500g",
        "need": { "quantity": 500, "unit": "g", "scaled_for": 4 },
        "product": { "catalog_id": "CAT-001138", "name": "Cá lóc làm sạch vỉ 300g", "category": "Cá, hải sản", "pack_size": 300, "pack_unit": "g" },
        "derived": false, "default_qty": 1, "pack_hint": 2,
        "variant": { "variant_id": "variant_01...", "product_id": "prod_01...", "handle": "ca-loc-lam-sach-vi-300g",
                     "title": "Cá lóc làm sạch vỉ 300g", "unit_label": "vỉ 300g", "unit_price": 59000,
                     "available": 12, "purchasable": true },
        "alternatives": [ { "catalog_id": "CAT-...", "name": "...", "variant": { "...": "như trên" } } ]
      }],
      "maybe_have": [ "…cùng dạng, default_qty = 0…" ] } }] }
```

`/store/ai/copilot` → `StoreAiCopilotResponse`:

```json
{ "data": { "…như /store/ai/search…": "" },
  "ai": { "provider": "gemini", "model": "...", "recipe_id": "canh-chua-ca-loc", "explanation": "...",
          "item_notes": [ { "ingredient": "cá lóc", "note": "Nên mua khoảng 2 vỉ cho 4 người" } ],
          "prep_notes": [ { "ingredient": "nước me", "steps": ["..."] } ],
          "follow_up_question": null },
  "ai_status": "ok", "latency_ms": 2300 }
```

### Phần backend gắn vào: `variant` (`StoreVariantInfo`)

| Trường | Ý nghĩa |
| :--- | :--- |
| `variant_id`, `product_id`, `handle` | Biến thể có `sku = catalog_id`; `handle` để mở trang sản phẩm |
| `title`, `unit_label` | Tên sản phẩm và tên biến thể trong Medusa (có thể khác `product.name` của AI) |
| `unit_price` | VND, giá đang tính (gồm khuyến mãi), như API-1 |
| `available` | Tồn đã trừ phần khách khác đang giữ, như API-15 |
| `purchasable` | `false` khi `available = 0` |

`variant: null` khi `catalog_id` không có biến thể bán được (sản phẩm đang ẩn, ví dụ 3 món `draft` của catalog v2). Storefront vẫn hiện tên (`product.name`) nhưng không cho thêm vào giỏ.

### Cách storefront dùng (gợi ý cho nhóm AI)

- `accepted: false` → vẫn hiện `results` (món gần nhất) kèm cảnh báo "Chưa có món đúng ý".
- Số lượng mặc định: `default_qty` (1 ở `buy`, 0 ở `maybe_have`); `pack_hint` là số gói gợi ý khi có.
- Đổi sản phẩm: chọn trong `alternatives` (mỗi phương án có `variant` riêng).
- `ai: null` hoặc `ai_status` khác `ok` → hiện `data` bình thường, không có lời AI.
- `derived: true` (nguyên liệu tự làm, ví dụ nước me từ me) → không bán riêng; `prep_notes` có hướng dẫn.
- **Thêm vào giỏ**: dùng route giỏ của Medusa với `variant_id` (hoặc một route gom nhiều dòng do nhóm AI thêm). Trang thanh toán đã giữ hàng trước khi sang VNPAY (API-14), nên món vừa hết sẽ bị chặn ở đó.

## 4. Lỗi

| Mã | Khi nào |
| :--- | :--- |
| `400` | Body sai ràng buộc, thiếu publishable key |
| `501 { code: "IN_DEVELOPMENT" }` | Bản giữ chỗ hiện tại (AI chưa nối) |
| `503 { code: "AI_UNAVAILABLE" }` | (khi nối xong) AI service không trả lời được và không có bản dự phòng. Storefront hiện "Trợ lý Bếp tạm nghỉ" **[cần nhóm AI xác nhận]** |
