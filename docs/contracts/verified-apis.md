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

## BE-3 — Tìm kiếm, lọc tồn kho / khuyến mãi (VND)

**Kết quả đã chạy thật:**
- **`src/search/**` bị nạp hết lúc khởi động.** `SearchIndexLoader` (`framework/dist/search/search-index-loader.js`) `dynamicImport` mọi file trong thư mục, trừ `index.*`, `*.d.ts`, `*.md`, `*.map` và tên bắt đầu bằng `_`. Đặt `*.unit.spec.ts` ở đây làm app lỗi `Cannot add a test after tests have started running`. Quy ước: chỉ để helper thuần không side effect trong `src/search/`; unit test của helper đặt ở `src/lib/__tests__/` (ví dụ `search-stock.unit.spec.ts`).
- **Search Module đã được `defineConfig` đăng ký sẵn** (S1), nên không sửa `medusa-config.ts`.
- **Tên sự kiện tồn kho** (`utils/dist/core-flows/events.js`): `InventoryLevelWorkflowEvents.{CREATED,UPDATED,DELETED}` = `inventory-level.*`; `ReservationItemWorkflowEvents.{CREATED,UPDATED,DELETED}` = `reservation-item.*`. Payload là `{id}` hoặc mảng `{id}`. Đã thêm cả sáu vào `PRODUCT_EVENTS`.
- **Đường tra ngược sự kiện → sản phẩm** (chạy được với `query.graph`): `inventory_level.inventory_item_id` / `reservation_item.inventory_item_id` → `inventory_item.variants.product_id`.
- **Đọc tồn trong lúc index:** `product` với `sales_channels.stock_locations.id` và `variants.inventory_items.inventory.location_levels.{location_id,stocked_quantity,reserved_quantity}`; tồn khả dụng = tổng `stocked − reserved` tại kho nối sales channel (biến thể nhiều item lấy item cạn nhất chia `required_quantity`).
- **Tìm không dấu:** `filters.q = "ca chua"` ra "Cà chua Đà Lạt" với cấu hình mặc định của provider, **không cần chỉnh `language`** (cả trong test lẫn trên DB dev).
- **Lọc/sort dùng filter phẳng:** `filters: { in_stock: true }`, `{ on_sale_vnd: true }`, `pagination: { order: { min_price_vnd: "ASC" } }`; trường chưa có trong index trả 400 `Unknown field`.
- **Test runner:** `waitForSearchReady(container, probe)` trong `integration-tests/http/_helpers.ts` (migration plan + seed plan thủ công, rồi thăm dò `/store/search` tới khi 200); gọi **trước** khi seed sản phẩm. Index nạp bất đồng bộ qua event bus nên test phải `waitFor` (đặt 30 giây; mặc định 5 giây dễ hết hạn khi máy chậm).
- **DB dev:** `npx medusa db:migrate` đã tạo `product_v2` (schema mới: `vnd`, `in_stock`) ở trạng thái `pending`, nên `db:migrate:search` báo "already up-to-date". Version chỉ chuyển `ready` và nạp 32 tài liệu khi **app khởi động** (`medusa develop`, mất khoảng 135 giây trên máy này). Sau đó `in_stock=true` ra 31 sản phẩm (trừ `tom-the-tuoi`), `on_sale_vnd=true` ra 3 sản phẩm.

**Bằng chứng:** `integration-tests/http/search.spec.ts` (6 test), `src/lib/__tests__/search-stock.unit.spec.ts`; kiểm đột biến: vô hiệu nhánh `reservation-item` thì test "giữ chỗ" đỏ (`waitFor` hết hạn).
**Quyết định:** lần seed đầu trên DB mới cần khởi động app một lần để index kích hoạt; `npm run seed` (`medusa exec`) không kích hoạt version mới.

## BE-4 — Khung giờ giao hàng

**Kết quả đã chạy thật:**
- **Error handler ghi đè `code` của lỗi CONFLICT.** `framework/dist/http/middlewares/error-handler.js`: mọi `MedusaError.Types.CONFLICT` trả 409 nhưng đặt `body.code = "invalid_state_error"` và thay `message`. Vì vậy `MedusaError(CONFLICT, msg, "SLOT_UNAVAILABLE")` không tới được client; route `POST /store/carts/:id/delivery-slot` bắt lỗi có `code === "SLOT_UNAVAILABLE"` và tự trả `409 { code, type, message }`. `NOT_FOUND` → 404 giữ nguyên `message` (dùng để nêu id bị thiếu).
- **Giỏ không tồn tại → 404:** `useQueryGraphStep({ entity: "cart", filters: { id }, options: { throwIfKeyNotFound: true } })` ném lỗi not_found có chứa id giỏ.
- **Ghi metadata:** `updateCartsStep([{ id, metadata }])`; workflow tự gộp `{ ...metadata cũ, slot }` nên `delivery_note` được giữ. `cart.metadata.slot` là object `{ id, label, startsAt, endsAt, fee }` (không lưu `available` vì đổi theo thời gian).
- **Body:** `validateAndTransformBody(z.object({ slot_id: z.string().min(1) }))` (zod từ `@medusajs/framework/zod`) trong `middlewares.ts` với `method: ['POST']`; thiếu `slot_id` → 400.
- **Giờ VN không phụ thuộc máy:** `listSlots` cộng 7 giờ rồi chỉ dùng `getUTC*`/`toISOString`; ranh giới: khung mở khi `startsAt − now ≥ 60 phút` (đúng 60 phút còn đặt được, thiếu 1 giây thì không).
- **Giả đồng hồ trong integration test:** `jest.useFakeTimers({ now, doNotFake: [mọi timer…] })` chỉ giả `Date`; app (`inApp: true`) cùng tiến trình nên `new Date()` trong step nhận đúng giờ giả. Bọc quanh từng request và `useRealTimers()` trong `finally`.
- **Khung giờ trong thiết kế** (`Com4Fud_UI_SVG/_source/src/pages_b.js`, mục "Thời gian giao"): 07:00–09:00, 15:00–17:00, 17:00–19:00, 19:00–21:00. Không có khung 08h; id khung sáng là `…T07`.

**Bằng chứng:** `src/lib/delivery/__tests__/slots.unit.spec.ts` (7 test), `integration-tests/http/delivery-slots.spec.ts` (6 test).
**Quyết định:** `GET /store/delivery-slots` cũng đi qua workflow `list-delivery-slots` (một step) để route nào cũng chỉ gọi workflow.

## BE-5a — Provider VNPAY và IPN

**Kết quả đã chạy thật (giá trị giả trong `.env.test`, chưa gọi cổng VNPAY thật):**
- **`provider` trong event phải là `vnpay_vnpay`, không có `pp_`.** `PaymentModuleService.getWebhookActionAndData` tự ghép `pp_${provider}` (`payment/dist/services/payment-module.js` ~dòng 697). Test `provider trong event là vnpay_vnpay`: `vnpay_vnpay` → `captured`; `pp_vnpay_vnpay` bị từ chối. Trả lời mục S4 "chưa chạy với provider VNPAY thật".
- **Id phiên tới provider qua `context.idempotency_key`** khi `initiatePayment` (`payment-module.js` ~dòng 238); `updatePayment` không có chắc chắn nên lấy lại từ `data.txn_ref`.
- **Luồng `captured` khi chưa có payment** (`core-flows/dist/payment/workflows/process-payment.js`): `authorizePaymentSessionStep` → provider `authorizePayment` → tạo payment → `capturePaymentWorkflow` → (sau khi nhả khoá giỏ) `completeCartAfterPaymentStep`. Vì vậy payment được capture **trước**, đơn được tạo **sau** vài trăm ms: test phải chờ `order_cart`, không chỉ chờ payment.
- **`authorizePayment` phải cổng theo dấu đã trả.** `complete` giỏ của storefront cũng gọi `authorizePayment`; nếu luôn trả `authorized` thì ai có id giỏ cũng lấy được đơn chưa trả tiền (đã chứng minh bằng đột biến: test `complete giỏ khi chưa thanh toán không tạo đơn` đỏ). Provider chỉ trả `authorized` khi `session.data.paid === true`; dấu này do route IPN ghi sau khi kiểm chữ ký, số tiền, rồi gọi `updatePaymentSession` (provider `updatePayment` giữ nguyên data khi đã `paid`).
- **Mã trả lời IPN:** 97 sai chữ ký; 01 txn_ref lạ hoặc không có phiên VNPAY; 04 sai số tiền; 02 phiên đã có payment; 00 còn lại (kể cả giao dịch thất bại như ResponseCode 24: ghi nhận tin, không đổi gì); 99 lỗi bất ngờ. Luôn HTTP 200.
- **IPN lặp / đồng thời:** gọi lại sau khi đã có payment → 02. Hai IPN đến cùng lúc → cả hai có thể trả 00 (đánh dấu paid rồi phát event) nhưng khoá giỏ của `processPaymentWorkflow` giữ kết quả: vẫn đúng một đơn, một payment (test đã chạy). Nếu event lần trước bị mất sau khi đánh dấu, lần gọi lại phát lại event thay vì kẹt giỏ.
- **`txn_ref` chỉ chữ-số:** `("payses_01ABC", 2) ↔ "paysesU01ABCU2"` (chữ `U` hoa phân cách; ULID Crockford base32 không có `U`, prefix viết thường).
- **Event:** `headers: {}` thay vì `req.headers` (không cần cho provider, tránh lưu header lạ vào hàng đợi); `delay: 0`.
- **Region:** `bootstrapStore` giờ cập nhật region đang có sang chỉ `pp_vnpay_vnpay` (test + kiểm đột biến). `pp_system_default` vẫn đăng ký trong module nhưng không còn trong region.
- Hậu quả: provider `validateOptions` ném lỗi khi thiếu `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` nên mọi lệnh nạp app (`medusa develop`, `db:migrate`, `npm run seed`) cần hai biến này trong `.env`.

**Chưa kiểm (cần bước thủ công):** chuỗi ký dạng mã hoá URL (`%20` → `+`) có được cổng sandbox VNPAY chấp nhận không, và IPN thật qua tunnel HTTPS. Nếu sandbox báo sai chữ ký, đổi `buildSignData` sang không mã hoá, sửa `signature.unit.spec.ts` và ghi kết quả vào mục này. Lưu ý: PHP `urlencode` còn mã hoá `!'()*~` trong khi `encodeURIComponent` thì không.

**Bằng chứng:** `src/modules/vnpay/__tests__/*.unit.spec.ts` (42 test), `integration-tests/http/vnpay-ipn.spec.ts` (11 test), `bootstrap-store.spec.ts`.

## BE-5b — Mã giảm giá và ví mã

**Kết quả đã chạy thật:**
- **`starts_at` / `ends_at` nằm ở campaign, không ở promotion** (`promotion/dist/models/campaign.js`; promotion chỉ có `campaign_id`). `HETHAN5` tạo kèm `campaign { name, campaign_identifier, starts_at, ends_at }` có `ends_at` trong quá khứ; ví mã đọc `campaign.ends_at` qua `query.graph`.
- **Rule của promotion** (`rules[] = { attribute, operator, values: string[] }`; giá trị là chuỗi): Medusa đánh giá rule trên đối tượng giỏ, nên `item_subtotal gte "150000"` và `customer.groups.id eq <groupId>` đều chạy thật. Đã kiểm: giỏ 160.000 + `TUOI20` → `discount_total 20000`; giỏ 64.000 → `0`; `THANHVIEN15` → `0` với khách thường, `15000` sau khi khách vào nhóm.
- **Mã chưa đủ điều kiện KHÔNG bị từ chối.** `POST /store/carts/:id/promotions { promo_codes: ["TUOI20"] }` với giỏ dưới 150.000 trả 200 và `discount_total` giữ 0; chỉ mã không tồn tại (`KHONGCO`) trả 4xx. **Storefront phải đọc lại `discount_total` (hoặc `promotions`) sau khi áp mã** để biết mã có hiệu lực, không dựa vào 4xx. "Mã không hợp lệ" chỉ hiện cho mã lạ.
- **Input workflow:** `createPromotionsWorkflow` `{ promotionsData: CreatePromotionDTO[] }` (`application_method: { type: "fixed", target_type: "order", allocation: "across", value, currency_code: "vnd" }`); `createCustomerGroupsWorkflow` `{ customersData: [{ name }] }`; `linkCustomersToCustomerGroupWorkflow` `{ id: groupId, add: [customerId] }`.
- **Auth:** core đã có `authenticate("customer", ["session","bearer"])` cho `/store/customers/me*` (`medusa/dist/api/store/customers/middlewares.js:55`); bỏ middleware riêng của ta thì chưa đăng nhập vẫn ra 401. Middleware tường minh trong `src/api/middlewares.ts` giữ lại theo plan (trùng lặp, vô hại).
- **D3:** ví chỉ hiện mã công khai và mã nhóm mà khách thuộc; mã nhóm khác bị ẩn hẳn (không hiện dạng `not_eligible`). Muốn hiện thì bỏ bước lọc `isVisibleToCustomer` trong route.
- Ví chưa nhận `cart_id`/`cart_subtotal`, nên mức tối thiểu của `TUOI20` không được xét ở ví (luôn `usable`); `classifyVoucher` đã hỗ trợ `cartSubtotal` khi cần.
- `seedPromotions` chạy trong `npm run seed` (cần `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` trong `.env`, xem BE-5a).

**Bằng chứng:** `src/lib/vouchers/__tests__/classify.unit.spec.ts` (11 test), `integration-tests/http/vouchers.spec.ts` (8 test).

## BE-6 — Stage đơn hàng theo sự kiện

**Kết quả đã chạy thật:**
- **Tra đơn từ fulfillment (S3) dùng đúng như đã ghi:** `query.graph({ entity: "fulfillment", fields: ["id","order.id"], filters: { id } })` trong `resolveOrderId.fromFulfillment`; test chuỗi `shipment.created` → SHIPPING và `delivery.created` → DELIVERED đi qua nó (không cần dự phòng).
- **Hằng số event:** `OrderWorkflowEvents.{PLACED,FULFILLMENT_CREATED,CANCELED}` và `FulfillmentWorkflowEvents.{SHIPMENT_CREATED,DELIVERY_CREATED}` (`utils/dist/core-flows/events.js`). Payload: `order.placed {id}`, `order.fulfillment_created {order_id, fulfillment_id}`, `shipment.created {id: fulfillment id}`, `delivery.created {id: fulfillment id}`, `order.canceled {id}`.
- **Đơn dựng bằng giỏ (`completeCartWorkflow`) đã đủ cho cả chuỗi fulfillment:** có shipping method và reservation nên `createOrderFulfillmentWorkflow` chạy được, và `order.placed` được phát thật. Đơn `createOrderWorkflow` không có hai thứ đó (`create-fulfillment.js` yêu cầu reservation cho biến thể `manage_inventory`) và không phát `order.placed`. Region chỉ còn VNPAY (BE-5a) nên test thêm `pp_system_default` vào region để hoàn tất giỏ.
- **Tạo admin trong test/script (S7 còn thiếu):** `createUsersWorkflow` **không** nhận `authIdentityId`. Làm đúng như `medusa user` (`medusa/dist/commands/user.js`): `createUsersWorkflow({ users: [{ email }] })` → `authService.register("emailpass", { body })` → `authService.updateAuthIdentities({ id, app_metadata: { user_id } })` → `POST /auth/user/emailpass` lấy token. RBAC (role super admin) chỉ gán khi bật feature flag `rbac`, mặc định tắt. Helper: `integration-tests/http/_admin.ts`.
- **Ghi stage:** `updateOrdersStep({ selector: { id }, update: { metadata } })` ghi thẳng order module và không phát `order.updated`; workflow tự trộn `{ ...metadata cũ, stage, stage_log }`. Khoá theo đơn bằng `acquireLockStep` / `releaseLockStep` (`timeout` tính bằng giây; compensation của bước acquire nhả khoá khi workflow lỗi) để hai event sát nhau không ghi đè `stage_log` của nhau.
- **Event lặp hoặc lệch thứ tự** bị từ chối bằng `INVALID_DATA` (chuyển về chính nó cũng không hợp lệ) và subscriber chỉ `logger.warn`. Test đếm cảnh báo để chứng minh subscriber đã chạy, không chỉ "stage_log không đổi".
- **Đơn cũ bị huỷ khi chưa có stage** (ví dụ tạo bằng `createOrderWorkflow` rồi `cancelOrderWorkflow`) vẫn **không có stage**: `undefined` chỉ được vào PENDING nên `order.canceled` bị từ chối. Script backfill suy ra `CANCELLED` từ `status === "canceled"` cho các đơn này.
- **Route confirm:** `POST /admin/orders/:id/confirm` trả 200; đơn không ở PENDING → 400 (`INVALID_DATA`), đơn lạ → 404, chưa đăng nhập → 401 (core xác thực `/admin/*`).
- **Backfill:** `npx medusa exec ./src/scripts/backfill-order-stage.ts` (logic ở `backfillOrderStages`); chỉ đụng đơn chưa có `metadata.stage`, ghi `stage_log: [{ stage, at, by: "backfill" }]`, dùng `Modules.ORDER` `updateOrders(id, { metadata })`.

**Bằng chứng:** `src/lib/order-stage/__tests__/stages.unit.spec.ts` (7 test, gồm ma trận 7×6), `integration-tests/http/order-stage.spec.ts` (5 test).
