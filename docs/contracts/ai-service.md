# Hợp đồng backend ↔ AI service

> Task AI-0 (2026-11-06): dọn đường cho nhóm AI nối 2 model vào backend. **Backend chưa gọi AI service**: file này chốt hợp đồng, cấu hình và ai làm phần nào. Kiểu TypeScript tương ứng ở `apps/backend/src/types/ai.ts`. Hợp đồng storefront ↔ backend của Trợ lý Bếp ở [`ai-copilot.md`](ai-copilot.md); của "Mua lại" là API-3 (bảng API trong `docs/plans/2026-10-18-sync-ui-v2-backend.md`).
>
> Nguồn: repo `grocery-store-ai`, nhánh `feature/predictive-reorder` (Irvine, `/api/v1/predict`, 2026-11-05) và `feature/recipe-rag-copilot` (Phú Hưng, `docs/recipe_rag/plan-ai-copilot.md` mục 3, 2026-11-05). Chỗ đánh dấu **[cần nhóm AI xác nhận]** là đề xuất của backend, chưa có trong code AI.

## 1. Ai làm phần nào

| Phần | Người làm | Ghi chú |
| :--- | :--- | :--- |
| AI service: `/api/v1/predict` | Nhóm AI (Irvine) | Đã chạy |
| AI service: `/api/v1/search`, `/api/v1/copilot`, `/admin/*` | Nhóm AI (Phú Hưng) | Service đã có, route HTTP chưa có (GĐ 8 trong plan AI) |
| Backend: gọi `/predict` trong giỏ "Mua lại" (thay bản tạm BE-9) | Nhóm AI (Irvine, nhánh `reorder`) | Mục 4 |
| Backend: `/store/ai/search`, `/store/ai/copilot`, thêm vào giỏ, route admin | Nhóm AI (Phú Hưng) | Mục 5, hợp đồng storefront ở `ai-copilot.md` |
| Storefront: màn hình Trợ lý Bếp | Nhóm AI (Phú Hưng) | Theo plan AI mục 6 |
| Hợp đồng, cấu hình, route giữ chỗ trả 501 | Backend (AI-0, xong) | File này |

Đường đi cố định: **storefront → backend Medusa → AI service**. Storefront không gọi thẳng AI service (giá, ảnh, tồn, giỏ chỉ có ở Medusa; AI service chỉ biết `catalog_id`).

## 2. Chạy AI service cạnh backend

| Mục | Giá trị | Lý do |
| :--- | :--- | :--- |
| Cổng AI service | **8100**: `uvicorn src.main:app --port 8100` (một tiến trình chạy cả hai module) | `uvicorn` mặc định 8000, trùng storefront (proposal ghi 8100) |
| Chạy tách hai tiến trình | Trợ lý Bếp `uvicorn src.apps.chef:app --port 8100`, Mua lại `uvicorn src.apps.reorder:app --port 8101` | Một bên sập, treo hay hết RAM không kéo bên kia theo. Mua lại không cần torch hay `ai_db` nên lên trong vài giây. Backend đặt thêm `AI_REORDER_URL` |
| Cổng `ai_db` (Postgres + pgvector của AI) | **5435**: đặt `AI_DB_PORT=5435` trong `.env` của repo AI | Mặc định 5434 trùng `com4fud-postgres` của backend; compose của AI đã đọc biến này |
| File model "Mua lại" | `weights/lgbm_v4_selected.onnx` | **Không có trong git** (quy định không commit artifact). Xin Irvine hoặc chạy lại pipeline của repo AI (cần dữ liệu Instacart). Thiếu file thì `/predict` trả `503` |
| Khóa Gemini/Claude/OpenRouter | `.env` của repo AI | Không bao giờ ở backend |

Biến môi trường của backend (`apps/backend/.env.template`):

| Biến | Mặc định | Dùng cho |
| :--- | :--- | :--- |
| `AI_SERVICE_URL` | `http://localhost:8100` | Gốc của mọi endpoint dưới đây |
| `AI_REORDER_URL` | (trống) | Gốc riêng của `/api/v1/predict` khi Mua lại chạy thành tiến trình riêng (`http://localhost:8101`). Trống thì dùng `AI_SERVICE_URL` |
| `AI_INTERNAL_KEY` | (trống) | Gửi trong header `X-Internal-Key`; cùng giá trị ở `.env` của AI service. Không commit khóa thật |
| `AI_PREDICT_TIMEOUT_MS` | `500` | `/api/v1/predict` (proposal: quá 500 ms thì ẩn hoặc dùng bản tạm) |
| `AI_SEARCH_TIMEOUT_MS` | `3000` | `/api/v1/search` (plan AI: p95 mục tiêu < 1 giây) |
| `AI_COPILOT_TIMEOUT_MS` | `35000` | `/api/v1/copilot` (AI service tự cắt ở `ai_total_budget_s` = 30 giây rồi trả bản dự phòng) |

## 3. Quy ước chung

- **Tiền tố `/api/v1`** cho mọi endpoint nghiệp vụ, như `/api/v1/predict` đang chạy (`api_router` của repo AI). Plan Trợ lý Bếp ghi `/v1/search`, `/v1/copilot`: đề xuất đổi thành `/api/v1/search`, `/api/v1/copilot` cho cùng một router **[cần nhóm AI xác nhận]**. Health: `GET /api/v1/health`.
- **Xác thực:** mọi endpoint trừ health cần header `X-Internal-Key: <AI_INTERNAL_KEY>` (plan AI mục 3). `/api/v1/predict` cũng kiểm khóa; backend gửi khóa ở `src/lib/predictive/ai-client.ts`. Sai hoặc thiếu khóa: `401`; AI service chưa đặt khóa: `503`.
- **Health:** `GET /api/v1/health` trả `{ status, modules, ai_providers, reorder_model_loaded }`. `modules` ghi module mà tiến trình đó chạy (`chef`, `reorder`) là `"ok"` hay `"failed"`; `status` là `"degraded"` khi có module nạp lỗi. Module nạp lỗi thì route của nó trả `503`, module kia vẫn chạy.
- **Định danh sản phẩm: `catalog_id`** (`CAT-000001`…`CAT-002129`). Trong Medusa, `catalog_id` = **`sku` của biến thể** (BE-2), mỗi sản phẩm một biến thể. Backend đổi `catalog_id` ↔ biến thể bằng `product_variant` lọc theo `sku`.
- **Danh mục:** handle của 11 danh mục cha (`rau-cu`, `trai-cay`, `thit`, `hai-san`, `trung-sua`, `gao-do-kho`, `gia-vi`, `do-uong`, `mi-an-lien`, `banh-keo-an-vat`, `dong-lanh-che-bien`); khớp đúng khóa trong `src/ml/category_map.json` của AI.
- **Ngày giờ:** ISO 8601 có múi giờ (`2026-11-06T09:00:00+07:00`).
- **Khi AI lỗi, chậm hoặc trả `503`**, backend không báo lỗi cho khách mà dùng bản dự phòng (mục 4, 5). Lỗi ghi log ở backend kèm `request_id` nếu có.

## 4. "Mua lại" (AI #1): `POST /api/v1/predict`

Storefront không đổi: vẫn gọi API-3 (`GET /store/predictive/reorder-basket`), response giữ nguyên (`ReorderBasket` trong `src/workflows/get-reorder-basket.ts`). Chỉ thay **bước chọn món** của bản tạm (`src/lib/predictive/reorder.ts`, xếp theo tần suất).

Request (`AiPredictRequest`):

```json
{ "orders": [
    { "placed_at": "2026-10-07T15:12:00+07:00",
      "lines": [ { "product_id": "CAT-000939", "category": "rau-cu" },
                 { "product_id": "CAT-001138", "category": "hai-san" } ] } ],
  "top_k": 5 }
```

- `orders`: đơn **đã giao** của khách (`metadata.stage = DELIVERED`, như bản tạm), mới nhất trước, tối đa 500. Mỗi dòng một món, không gửi số lượng (model không dự đoán số lượng).
- `product_id` = `catalog_id` (sku); `category` = handle danh mục cha của sản phẩm.
- `top_k` = 5 (API-3 trả tối đa 5 món). Báo cáo của nhóm AI: **không áp τ khi chỉ lấy 5 món**; AI service tự bỏ τ khi `top_k` khác 15.
- `lot_expiry`: catalog chưa có hạn của lô, bỏ trống.

Response (`AiPredictResponse`): `status` (`ready` | `empty`), `items` (`product_id`, `score`, `rank`), `suppressed`, `tau_applied`, `low_history`, `model_file`.

Backend dựng API-3 từ `items`: đổi `product_id` → biến thể, giá đang tính, `in_stock`; món hết hàng hoặc đang ẩn thì bỏ qua và lấy món kế tiếp. `status: "empty"` → API-3 `status: "empty"`.

**Dự phòng:** quá `AI_PREDICT_TIMEOUT_MS`, `503`, lỗi mạng hoặc body sai → dùng bản tạm theo tần suất (hàm hiện có), API-3 vẫn trả `ready`/`empty` như bây giờ. Khách mới chưa có đơn đã giao: không gọi AI, `empty` như bản tạm.

**Không làm ở bước này** (ghi để sau): cache giỏ trong Redis `basket:{customer_id}` và `POST /store/predictive/warm` thật (proposal), Redis đã sẵn từ hot-stock.

## 5. Trợ lý Bếp (AI #2): `POST /api/v1/search`, `POST /api/v1/copilot`

Theo plan AI mục 3, giữ nguyên:

- Request (`AiSearchRequest`): `{ query (1–300), servings? (1–50), top_k? (1–10, mặc định 5), have? (tên nguyên liệu hoặc catalog_id), include_basket? (mặc định true) }`. `include_basket: false` trả danh sách món với giỏ rỗng, dùng cho màn tìm kiếm.
- Tìm theo tên: khách gõ có dấu thì so từng từ có dấu ("cơm" không khớp "cốm"); gõ không dấu thì hai bên cùng bỏ dấu.
- Giỏ: **mỗi sản phẩm chỉ có một dòng**. Nhiều nguyên liệu cùng ghép vào một sản phẩm thì gộp: `ingredient` nối bằng ", ", `ingredients[]` liệt kê từng nguyên liệu.
- `/api/v1/search` → `AiSearchResponse`: `query`, `servings`, `accepted`, `threshold`, `results[]` (`recipe`, `score`, `matched_by`, `complete`, `basket: { buy, maybe_have }`), mỗi dòng giỏ có `product.catalog_id`, `default_qty`, `pack_hint`, `alternatives[]`.
- `/api/v1/copilot` → `AiCopilotResponse`: `{ data: <như search>, ai: <lời AI> | null, ai_status, latency_ms }`. `data` luôn có.

Backend (`/store/ai/search`, `/store/ai/copilot`) chuyển tiếp body, rồi **gắn phần bán hàng** vào từng `product` và `alternatives[]` theo hợp đồng storefront ([`ai-copilot.md`](ai-copilot.md)): `variant_id`, giá đang tính, tồn đã trừ phần khách khác đang giữ (như API-15), `purchasable`.

**Màn công thức:** `POST /api/v1/recipe` (`{ recipe_id, servings?, have? }` → `recipe`, `servings`, `complete`, `prep_steps`, `cooking_steps`, `basket`, `ingredient_lines` (nguyên liệu đúng như công thức ghi, mỗi dòng một lần), `not_in_basket`; 404 nếu không có món) và `POST /api/v1/ask` (`{ recipe_id, question (1–300), servings? }` → `{ answer | null, status, provider, model, latency_ms }`; mô hình lỗi vẫn 200 với `answer: null`; 404 nếu không có món). Backend gắn `variant` vào `basket` của `/recipe` và chuyển nguyên `/ask`. Mọi route `/api/v1/*` (trừ `/health`) cần header `X-Internal-Key`. Quá giờ mặc định: `AI_RECIPE_TIMEOUT_MS` 3000, `AI_ASK_TIMEOUT_MS` 35000.

**Dự phòng:** `/store/ai/copilot` quá giờ hoặc lỗi → gọi `/api/v1/search` và trả `{ data, ai: null, ai_status: "fallback_error" }` nếu kịp; cả hai lỗi → `503 { code: "AI_UNAVAILABLE" }` để storefront hiện "Trợ lý Bếp tạm nghỉ, bạn thử lại sau". **[cần nhóm AI xác nhận]**

Admin (`/admin/ai-settings`, `/admin/ai-stats` của AI service) chỉ được gọi qua route admin của backend (đã xác thực admin Medusa), theo plan AI.

### `POST /api/v1/suggest/by-products` và `POST /api/v1/suggest/discover`

Gợi ý món bằng luật (không DB, không mô hình), chạy trong app Trợ lý Bếp. `by-products`: `{ catalog_ids (1–30), mode: "cart"|"product", limit (1–12), have, exclude_ids }`. `discover` (món thử mới): `{ bought_catalog_ids, have, seed, limit, exclude_ids }`. Trả `{ suggestions: [{ recipe, matched, new_count, familiar_count, missing_count, basket }] }`, mỗi họ món tối đa một món. Backend gọi `by-products` qua `/store/ai/suggest/by-products` (xem `ai-copilot.md`, mục 5).

## 6. Trả lời các câu hỏi nhóm AI đang chờ bên web (plan AI mục 6)

| Câu hỏi | Trả lời (2026-11-06) |
| :--- | :--- |
| Catalog v2 (2.129 sản phẩm) đã nạp vào Medusa, **SKU của variant = `catalog_id`**? | **Có.** Đối chiếu `data/recipe_rag/final/catalog_v2.json` của AI với `apps/backend/src/lib/seed/seed-data/catalog-v2.json`: cùng 2.129 `catalog_id`, không bên nào thiếu id |
| Luồng cơ bản (sản phẩm, giỏ, đăng nhập, thanh toán thử) | Chạy được trên nhánh `feature/medusa-backend-integration`. VNPAY vẫn giả lập (chưa có sandbox thật) |
| Giá và ảnh | **Mọi sản phẩm có giá** (giá ước tính bằng script của nhóm, `tools/catalog/build_catalog_v2.py`), 24 món có giá khuyến mãi. Ảnh (BE-2b bước 1): 1.746/2.129 sản phẩm có link ảnh; ảnh chỉ có trong DB của máy đã chạy `tools/catalog/fetch_images.py` và `npm run seed:images` (cách chạy: `tools/catalog/IMAGES.md`), 383 sản phẩm không có ảnh |
| Sản phẩm chưa mở bán | 3 món đang ẩn (`draft`): CAT-000720, CAT-000929, CAT-001008 (combo mất trang và bản trùng, xem `tools/catalog/hidden-products.md`). **Không công thức nào trong `recipes_matched_v2.json` dùng 3 món này.** Món ẩn vẫn có biến thể và sku nhưng Store API không trả về: backend đánh dấu `purchasable: false` |
| Quy ước backend | `grocery-store-backend/AGENTS.md`: logic trong workflow/module, route chỉ gọi workflow; dùng skill `medusa-dev` và MCP `medusa` |

## 7. Nhánh làm việc

Phần backend của nhóm AI tách nhánh từ **`dev`** sau khi PR `feature/medusa-backend-integration` → `dev` được merge (có hot-stock, Redis, API-15 và hợp đồng này). Nhánh `reorder` hiện có (tách từ `dev` ngày 2026-11-04) chưa có những phần đó: rebase lên `dev` mới trước khi làm.
