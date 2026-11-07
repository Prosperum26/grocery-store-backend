# Nối model mua lại vào backend và storefront

Ngày: 2026-11-07. Nhánh: `reorder` (backend, frontend). Repo AI giữ nguyên ở `feature/predictive-reorder`.

## Mục tiêu

Thay cách đếm tần suất tạm thời (BE-9) trong `GET /store/predictive/reorder-basket` bằng model LightGBM của `grocery-store-ai`, và hiện gợi ý thật ở cả trang chủ lẫn trang giỏ hàng.

**Hoàn thành khi:** khách có đơn đã giao thấy gợi ý do model chọn ở hai trang, "Thêm tất cả" thêm đúng các món còn hàng, và khi AI service lỗi thì khối gợi ý ẩn đi, các phần khác của trang vẫn chạy.

## Không thuộc phạm vi

- Cache Redis và tính trước: `POST /store/predictive/warm` vẫn chỉ trả `202`.
- Trạng thái `warming`, thay đổi thiết kế giao diện, xác thực giữa các service.
- Quy tắc hạn lô: không gửi `lot_expiry` vì catalog chưa có hạn sử dụng.
- Sửa code repo AI. Chỉ chạy nó ở cổng 8001 và cập nhật tài liệu nếu cần.

## Hợp đồng

API-3 giữ nguyên hình dạng: `{ status, items, total }`, không trả điểm, xác suất hay lý do. Khách chưa đăng nhập vẫn nhận `401`.

## Backend

### Luồng

1. Workflow `get-reorder-basket` đọc đơn của khách, chỉ giữ đơn `metadata.stage = DELIVERED`.
2. Không có đơn nào: trả `empty`, không gọi AI.
3. Gọi `POST {AI_SERVICE_URL}/api/v1/predict`.
4. Tra biến thể theo thứ hạng trả về, bỏ sản phẩm không ở trạng thái `published`, lấy 5 món đầu, gắn giá và tồn kho như hiện tại.

### Dữ liệu gửi AI

| Trường | Giá trị |
| :--- | :--- |
| `orders[].placed_at` | `at` của mốc đầu tiên trong `metadata.stage_log`; không có thì `created_at` (đơn demo có `created_at` là lúc seed) |
| `orders[].lines[].product_id` | `variant_id`. Catalog có một biến thể mỗi sản phẩm, nên kết quả dùng trực tiếp được |
| `orders[].lines[].category` | Handle danh mục đầu tiên của sản phẩm, không có thì `null`. Cả 11 handle khớp `weights/category_stats.json` |
| `top_k` | `10`: xin dư để bù sản phẩm ẩn. Khác 15 nên τ không áp dụng, đúng với kết luận τ làm giảm chỉ số top-5 trong báo cáo model |

Gửi tối đa 500 đơn gần nhất. Bỏ dòng không có `variant_id`, và bỏ đơn không còn dòng nào vì AI yêu cầu mỗi đơn có ít nhất một dòng.

### Số lượng

Model không dự đoán số lượng. Giữ quy tắc hiện có: số lượng xuất hiện nhiều nhất trong các lần mua món đó, hòa thì lấy số lớn hơn; cùng món ở hai dòng của một đơn thì cộng lại.

### Khi AI lỗi

Thiếu `AI_SERVICE_URL`, lỗi mạng, HTTP khác 2xx, quá 3 giây hoặc response sai định dạng: ghi log `warn` kèm nguyên nhân và trả `{ status: "empty", items: [], total: 0 }` với HTTP 200. Không dùng cách đếm tần suất làm dự phòng (quyết định của người dùng ngày 2026-11-07, có thể đổi sau).

### File

| File | Thay đổi |
| :--- | :--- |
| `src/lib/predictive/reorder.ts` | Bỏ xếp hạng theo tần suất. Còn hàm thuần: tạo body gửi AI, tính số lượng |
| `src/lib/predictive/ai-client.ts` | Mới: gọi `/predict`, timeout, kiểm response, trả `null` khi lỗi |
| `src/lib/predictive/__tests__/` | Cập nhật và thêm unit test |
| `src/workflows/get-reorder-basket.ts` | Dùng hai phần trên, bỏ comment "bản tạm" |
| `src/api/store/predictive/*/route.ts` | Sửa comment |
| `apps/backend/.env.template` | Thêm `AI_SERVICE_URL=http://localhost:8001` |
| `integration-tests/http/reorder-basket.spec.ts` | Dùng AI service giả |
| `README.md`, bảng API-3 ở `docs/plans/2026-10-18-sync-ui-v2-backend.md` | Cập nhật cách chạy và trạng thái |

## Frontend

- `src/app/[countryCode]/(main)/cart/page.tsx`: mock thì giữ `BuyAgain`, không mock thì dùng `BuyAgainLive`.
- `BuyAgainLive` đã không vẽ gì khi danh sách rỗng, nên không cần xử lý thêm cho khách chưa đăng nhập hoặc khi AI lỗi.
- Sửa các comment còn ghi là placeholder.

Giao diện khối gợi ý giữ nguyên.

## Rủi ro đã biết

- Khách có 1–2 đơn vẫn nhận gợi ý dù model chưa được đánh giá với nhóm này (`low_history`). Backend bỏ qua cờ này.
- Món không có danh mục có `category = null`. Mã nguồn cho thấy giá trị thiếu thành NaN như lúc train, nhưng phải có một lần chạy thật để xác nhận.
- Model học trên Instacart, chưa được đánh giá trên dữ liệu Com4Fud. Đơn demo ít nên gợi ý chỉ minh họa luồng chạy.
- `/predict` không có xác thực, chỉ dùng trong mạng nội bộ.

## Kiểm thử

- **Unit:** tạo body (chọn mốc thời gian, bỏ dòng và đơn rỗng, giới hạn 500), tính số lượng, client với từng kiểu lỗi.
- **Integration:** AI giả trả thứ hạng cố định: đúng thứ tự, bỏ sản phẩm ẩn, tối đa 5 món, đúng hình dạng API-3, hết hàng không tính vào tổng. AI giả lỗi: `empty` và HTTP 200. Khách mới: `empty`, không gọi AI. Chưa đăng nhập: `401`.
- **Frontend:** `yarn test`, `npx tsc --noEmit`, `yarn build`.
- **Chạy thật:** bật cả 3 service, đăng nhập `minhthu@com4fud.demo`, kiểm tra hai trang và "Thêm tất cả", rồi tắt AI để xác nhận khối gợi ý biến mất.
