# Verified Medusa 2.21.1 APIs (BE-0)

Kết quả spike S1–S8 của plan `2026-10-25-hoan-thien-backend-issue13.md`. Mỗi mục: câu hỏi / kết quả / bằng chứng / quyết định.
Script đã chạy nằm ở `docs/contracts/spikes/` (chạy bằng cách chép vào `apps/backend/integration-tests/http/*.spec.ts` và đặt `SPIKE_OUT=<file json>`). Không nằm trong `testMatch` nên không chạy cùng bộ test.

Ghi chú môi trường (ảnh hưởng mọi task):

- **Windows:** script `test:*` trong `apps/backend/package.json` dùng cú pháp `TEST_TYPE=... jest`, `cmd.exe` không chạy được. Chạy qua Git Bash: `export npm_config_script_shell="C:\\Program Files\\Git\\bin\\bash.exe"` rồi `npm run test:... --workspace=@dtc/backend`. Đề xuất sửa lâu dài: thêm `cross-env` (chưa làm, ngoài phạm vi BE-0).
- DB dev: container `com4fud-postgres` (pgvector/pgvector:pg16, cổng host 5434), DB `medusa-backend`. `.env` và `.env.test` đều gitignore; `.env.test.template` là bản không mật khẩu. Test runner tự tạo DB tạm theo `DB_*` trong `.env.test`.
- `npx medusa db:migrate` trên DB trống **vẫn chạy** `src/migration-scripts/initial-data-seed.ts` (seed Europe/quần áo). BE-1 xoá file này.
- Node v24.14.1 (đạt `^20.19.0 || >=22.12.0`), npm 11.11.0 (repo ghim 10.9.8; npm 11 làm đổi cờ `dev`→`devOptional` trong `package-lock.json`, đã hoàn tác, không commit).

---

## S1 — Hình dạng body `POST /store/search`

**Kết quả:** body là **một query phẳng** hoặc `{ queries: [...] }` (tối đa 20). Mỗi query là object `.strict()`:
`{ entity: "product", fields?: string[], filters?: {...}, pagination?: { skip?, take? (≤100), order?: { <field>: "ASC"|"DESC" }, cursor? }, search_options?: {...} }`.
Từ khoá đặt ở **`filters.q`** (không có `q` ở cấp trên: `{entity, q}` bị 400 "Invalid request: Field 'queries' is required" vì union không khớp). Trả `{ results: [ { hits: [{ id, document }], metadata: { skip, take, count, query, processing_time_ms } } ] }`.
Thiếu publishable key → 400 `not_allowed`. Lọc `status=published` + `sales_channel_ids` do route tự thêm (client chỉ thu hẹp được).
Tìm không dấu: `{"entity":"product","filters":{"q":"ca chua"}}` trả "Cà chua" (provider postgres native xử lý được tiếng Việt không dấu với cấu hình mặc định, không cần chỉnh `language`).
Sort theo trường chưa có trong index bị 400 `Unknown field "min_price_vnd" used in pagination.order` (hiện index chỉ có giá `eur`/`usd`, BE-3 đổi sang `vnd`).

**Bằng chứng:** `node_modules/@medusajs/medusa/dist/api/store/search/{route,validators,middlewares}.js`; chạy `docs/contracts/spikes/spike-search-fields.ts` (khoá `S1_*`).

**Quyết định (hai điều khác plan, không chặn):**
1. Phải có `configureStoreSearch({ allowed_indexes: { product: true } })` trong `src/api/middlewares.ts` (đã có sẵn, giữ nguyên).
2. **Search Module + `search-postgres` đã được `defineConfig` đăng ký mặc định** (`@medusajs/utils/dist/common/define-config.js` ~dòng 250, `engine: "native"`). Bước "thêm `modules` vào `medusa-config.ts`" của BE-3 là **không bắt buộc**; nếu thêm tường minh thì phải giữ đúng `id: "postgres"`.
3. **Trong test runner, index chỉ dùng được khi có "active version".** Runner tự migrate index và seed nền lúc khởi động; phải chờ (poll `POST /store/search` tới khi 200) hoặc gọi thủ công `searchModule.createIndexMigrationPlan()` → `executeIndexMigrationPlan()` → `createSeedPlan_()` → `executeSeedPlan_()`. Sản phẩm tạo trước khi index active được seed bù khi index lên. BE-3 đưa helper `waitForSearchReady` vào `_helpers.ts`.

## S2 — `fields=+categories.handle` và `+variants.metadata`

**Kết quả:**
- `+variants.metadata`: **trả về mà không cần `allowFields`**, vì mặc định `*variants` đã gồm mọi cột của biến thể (`metadata: {is_default:true}` có trong response). Chuỗi `variants.metadata` không nằm trong `allowed` nhưng không bị lược khi đã có `*variants`.
- `categories`: `+categories`, `+categories.id`, `+categories.name`, `+categories.handle`, `categories.handle` đều **bị lược im lặng** (không có khoá `categories`). `*categories` (cả quan hệ) **trả đủ** `id,name,handle,...`.
- `GET /store/orders/:id?fields=+metadata` → **không có `metadata`** (đúng V2).

**Bằng chứng:** `docs/contracts/spikes/spike-search-fields.ts` (khoá `S2_*`); `store/products/query-config.js`, `store/orders/query-config.js`.

**Quyết định:** dùng phương án dự phòng `allowFields` (BE-3a) cho `categories.id/handle/name` và `metadata` của đơn. Phần `variants.metadata` trong test BE-3a (a) sẽ **không FAIL ở bước đỏ** (đã pass sẵn); chỉ `categories.handle` và `metadata` của đơn là đỏ. Cách khác không cần `allowFields`: storefront dùng `fields=*categories`.

**Xác nhận ở BE-3a:** `allowFields` trong middleware toàn cục (không có `method`) cho `/store/products*` (`variants.metadata`, `categories.id/handle/name`) và `/store/orders/:id` (`metadata`) làm `integration-tests/http/store-fields.spec.ts` từ đỏ sang xanh. Đỏ trước khi sửa: `categories[0].handle` và `order.metadata` đều `undefined`. `allowFields` chỉ `req.allowed.push(...fields)` (`framework/dist/http/middlewares/allow-fields-middleware.js`). Rủi ro: `GET /store/orders/:id` không xác thực, ai có UUID đơn đều đọc được `metadata`.

## S3 — Tra order từ fulfillment id / payment id

**Kết quả:** hai cách đều chạy với `query.graph`:
- `query.graph({ entity: "order_fulfillment", fields: ["order_id","fulfillment_id"], filters: { fulfillment_id } })`
- `query.graph({ entity: "fulfillment", fields: ["id","order.id"], filters: { id } })` → `[{ id, order: { id } }]`.
Cho đơn tạo bằng `completeCart`: `query.graph({ entity: "order_cart", fields: ["order_id","cart_id"], filters: { cart_id } })` ra order.
(Tra theo payment id chưa thử riêng; `payment.captured {id}` sẽ tra qua `order_payment_collection`/`payment_collection` ở BE-6 nếu cần.)

**Bằng chứng:** `spike-order-flow.ts` (khoá `S3_lookup_fulfillment_to_order`, `order_by_cart`).
**Quyết định:** subscriber `shipment.created` / `delivery.created` dùng `entity: "fulfillment"` với `order.id` (không cần dự phòng).

## S4 — Payload `PaymentWebhookEvents.WebhookReceived`

**Kết quả:** route POST gốc phát qua `eventBus.emit({ name: PaymentWebhookEvents.WebhookReceived, data: { provider, payload: { data: req.body, rawData: req.rawBody, headers: req.headers } } }, { delay: options.webhook_delay || 5000, attempts: options.webhook_retries || 3 })` rồi trả 200. Subscriber `payment-webhook-handler` (`medusa/dist/subscribers/payment-webhook.js`): gọi `paymentService.getWebhookActionAndData(input)`; **bỏ qua nếu thiếu `data.session_id`** hoặc action là `not_supported/canceled/failed/requires_more/pending_authorization/pending`; còn lại chạy `processPaymentWorkflow` với kết quả đó (`captured`/`authorized` → hoàn tất giỏ nếu chưa).
`provider` là **id provider đầy đủ khi có `pp_` hay không phụ thuộc route**: route POST truyền `req.params.provider` nguyên văn; `getWebhookActionAndData` của PaymentModule tìm provider theo `pp_${provider}` hoặc id — **chưa chạy với provider VNPAY thật**, kiểm lại ở BE-5a bước 3.

**Bằng chứng:** `medusa/dist/api/hooks/payment/[provider]/route.js`, `medusa/dist/subscribers/payment-webhook.js`.
**Quyết định:** route IPN (GET) của BE-5a phát cùng event với `payload: { data: req.query, rawData: undefined, headers: req.headers }`, `provider: "vnpay_vnpay"` (đối chiếu ở BE-5a), **`delay: 0`** (không đợi 5 giây) và IPN trả `02` dựa trên trạng thái phiên đã captured. Chữ ký phải verify trong route (trước khi phát event) **và** trong `getWebhookActionAndData`.

## S5 — Upload file từ script / dạng URL

**Kết quả:** `uploadFilesWorkflow(container).run({ input: { files: [{ filename, mimeType, content: <base64>, access: "public" }] } })` trả `[{ id, url }]`. Provider local trả URL `http://localhost:9000/static/<timestamp>-<filename>`; **tên file được thêm tiền tố timestamp** nên gọi lại sẽ tạo bản mới (BE-2b phải tự chống trùng: bỏ qua sản phẩm đã có `thumbnail`). Trong test, file ghi vào `uploads/` của `apps/backend` (đã gitignore `/uploads`).

**Bằng chứng:** `spike-search-fields.ts` (khoá `S5_file_upload`); `core-flows/dist/file/workflows/upload-files.d.ts`.
**Quyết định:** dùng `uploadFilesWorkflow` (không cần dự phòng). `url` có host `localhost:9000`: storefront cần `remotePatterns` (FE-B) và production cần S3.

## S6 — Admin: locale `vi`, i18n, màu

**Kết quả:**
- Dashboard **có sẵn locale `vi`**: `node_modules/@medusajs/dashboard/src/i18n/translations/vi.json`, đăng ký trong `languages.ts` (`code: "vi"`, "Tiếng Việt"). Người dùng chọn trong Admin → Profile → Language.
- `src/admin/i18n/index.ts` được plugin Vite gom bằng `deepMerge` vào `resources` của i18next: dạng đúng là `export default { vi: { translation: { ... } } }` (cùng hình dạng với `resources` của dashboard).
- Đổi màu chủ đạo của Admin: **không tìm thấy** cơ chế cấu hình (theme chỉ có light/dark qua `medusa_admin_theme`).

**Bằng chứng:** `dashboard/src/i18n/{languages.ts,translations/index.ts}`, `admin-vite-plugin/dist/index.js` (`generateI18n`).
**Quyết định:** dùng dự phòng đã nêu: chỉ widget/trang của nhóm dùng bảng màu Com4Fud; Admin gốc giữ màu Medusa. Chưa kiểm bằng trình duyệt (BE-12).

## S7 — Input thực tế của các workflow

**Kết quả (đều chạy thật):**
- `createOrderWorkflow(c).run({ input: { region_id, sales_channel_id, currency_code, email, status: "pending", items: [{ variant_id, quantity, title, unit_price }], metadata } })` → tạo đơn; **không** phát `order.placed` (chỉ `completeCartWorkflow` phát; đã thấy `order.placed {id}` khi hoàn tất giỏ). Không tạo reservation.
- Đơn thật qua giỏ: `POST /store/carts` (body có `items`) → `POST /store/carts/:id/shipping-methods {option_id}` → `POST /store/payment-collections {cart_id}` → `POST /store/payment-collections/:id/payment-sessions {provider_id:"pp_system_default"}` → `POST /store/carts/:id/complete`.
- `createOrderFulfillmentWorkflow(c).run({ input: { order_id, items: [{ id: <order line item id>, quantity }] } })` → trả fulfillment, phát `order.fulfillment_created {order_id, fulfillment_id}`. Số lượng đơn lấy từ **`items.detail.quantity`** (`items.quantity` là undefined khi `query.graph`).
- `createOrderShipmentWorkflow(c).run({ input: { order_id, fulfillment_id, items: [{ id, quantity }] } })` → phát `shipment.created { id: <fulfillment id> }`.
- `markOrderFulfillmentAsDeliveredWorkflow(c).run({ input: { orderId, fulfillmentId } })` → phát `delivery.created { id: <fulfillment id> }`.
- `createPriceListsWorkflow(c).run({ input: { price_lists_data: [{ title, description, status: "active", type: "sale", prices: [{ variant_id, amount, currency_code }] }] } })` chạy được.
- Khách: `POST /auth/customer/emailpass/register {email,password}` → `token`; `POST /store/customers {email,first_name}` với `Authorization: Bearer <token>` tạo khách; `POST /auth/customer/emailpass` đăng nhập lấy token.
- Admin: `npx medusa user -e <email> -p <mật khẩu>` tạo user (đã chạy OK trên dev DB). Tạo user admin trong **script** chưa thử riêng.
- Seed stock location/fulfillment/shipping option: mẫu trong `spike-order-flow.ts` (stock location → link `manual_manual` → fulfillment set + service zone `vn` → link → `createShippingOptionsWorkflow` với `prices: [{ currency_code: "vnd", amount: 15000 }]`).

**Bằng chứng:** `docs/contracts/spikes/spike-order-flow.ts`, `spike-search-fields.ts` (khoá `S7_*`, `customer_register`, `events`).
**Quyết định:** dùng nguyên các hình dạng trên. Test hết hàng: `inventory_quantity` sau khi hoàn tất giỏ giảm theo reservation (V6).

## S8 — `POST /store/carts/:id/complete` trên giỏ đã hoàn tất

**Kết quả:** lần hai (cùng giỏ) trả `200 { type: "order", order }` **với đúng đơn cũ** (cùng id), không lỗi và không tạo đơn mới. Sau khi hoàn tất, `GET /store/carts/:id?fields=+completed_at` trả `completed_at` khác null.

**Bằng chứng:** `spike-order-flow.ts` (khoá `S8_complete_1`, `S8_complete_2`, `S8_cart_completed_at`).
**Quyết định:** trang return của storefront có thể gọi lại `complete` an toàn để lấy đơn đã được IPN hoàn tất, không cần dự phòng. Lưu ý: nếu IPN chưa tới thì `complete` ở trang return sẽ cố hoàn tất giỏ khi payment session chưa captured — BE-5a phải kiểm: chỉ gọi `complete` sau khi `verify-return` báo `success` và poll `completed_at`.
