# Verified Medusa 2.21.1 APIs (BE-0)

Kết quả spike S1–S8 của plan `2026-10-25-hoan-thien-backend-issue13.md`. Mỗi mục: câu hỏi / kết quả / bằng chứng / quyết định.
Script đã chạy nằm ở `docs/contracts/spikes/` (chạy bằng cách chép vào `apps/backend/integration-tests/http/*.spec.ts` và đặt `SPIKE_OUT=<file json>`). Không nằm trong `testMatch` nên không chạy cùng bộ test.

Ghi chú môi trường (ảnh hưởng mọi task):

- **Windows:** script `test:*` trong `apps/backend/package.json` ban đầu dùng cú pháp `TEST_TYPE=... jest`, `cmd.exe` không chạy được. **Đã sửa ở BE-12:** thêm `cross-env`, giờ `npm run test:... --workspace=@dtc/backend` chạy được từ PowerShell/cmd, không cần đặt `npm_config_script_shell`.
- DB dev: container `com4fud-postgres` (pgvector/pgvector:pg16, cổng host 5434), DB `medusa-backend`. `.env` và `.env.test` đều gitignore; `.env.test.template` là bản không mật khẩu. Test runner tự tạo DB tạm theo `DB_*` trong `.env.test`.
- `npx medusa db:migrate` trên DB trống **vẫn chạy** `src/migration-scripts/initial-data-seed.ts` (seed Europe/quần áo). BE-1 xoá file này.
- Node v24.14.1 (đạt `^20.19.0 || >=22.12.0`). `package-lock.json` của commit khởi tạo ghi cờ `dev` cho khoảng 20 gói mà npm hiện tại (cả 10.9.8 repo ghim lẫn 11) tính là `devOptional`, nên `npm install` nào cũng làm lock thay đổi. **BE-12** commit lock do npm 10.9.8 sinh ra (chỉ đổi cờ, không đổi phiên bản gói) để hết thay đổi này. Cài gói mới thì dùng `npx npm@10.9.8 install ...`.

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

## BE-7 — Bắt đầu giao, ETA, widget Admin

**Kết quả đã chạy thật:**
- **Stage không do workflow đặt.** `startDeliveryWorkflow` chỉ ghi `metadata.delivery` rồi chạy `createOrderShipmentWorkflow.runAsStep`; `shipment.created` đã có subscriber BE-6 đưa đơn sang SHIPPING (test chờ bằng `waitForStage`). Event của `emitEventStep` chỉ phát khi workflow thành công, nên shipment lỗi thì không có `shipment.created` và stage giữ PREPARING.
- **409 cho đơn sai stage:** `MedusaError.Types.CONFLICT` (khác `INVALID_DATA` = 400 của `setOrderStageWorkflow`). Đơn lạ 404 nhờ `throwIfKeyNotFound`, chưa đăng nhập 401 (core).
- **Chống bấm hai lần:** workflow chọn fulfillment có `shipped_at` rỗng; lần hai không còn fulfillment nào nên 409 dù stage chưa kịp đổi (subscriber bất đồng bộ). Thêm khoá `start-delivery-<order_id>` cho hai request đồng thời.
- **Query chạy được:** `order` với `shipping_address.*`, `fulfillments.{id,shipped_at,canceled_at}`, `fulfillments.items.{line_item_id,quantity}`. Shipment chỉ giao các dòng của fulfillment được chọn (input theo S7: `items: [{ id, quantity }]`).
- **Bù trừ:** step ghi metadata đọc lại metadata hiện tại rồi chỉ khôi phục khoá `delivery` (giá trị cũ, hoặc xoá khoá nếu trước đó chưa có), không đè `stage`. Kiểm đột biến: tắt compensation thì test "khôi phục" đỏ.
- **Ép lỗi trong test mà không đụng code production:** đăng ký `createOrderShipmentWorkflow.hooks.shipmentCreated(...)` ở đầu file spec, ném lỗi khi cờ `failShipment` bật.
- **ETA:** `estimateDelivery(address, startedAt)` trong `src/lib/delivery/estimate.ts`, bảng `DISTRICT_KM` ước lượng thủ công từ Kho Q.7 (O5), 20 km/h, `ceil` phút, mặc định 6 km. Quận được tìm trong chuỗi ghép `address_1, address_2, city, province`. Phép tính `km * 60 / 20` (nhân trước) để tránh `ceil(9.000000000000002)`.
- **`metadata.delivery`** hiện gồm `distance_km`, `eta_at`, `started_at`, `notice_sent_at` (O2: chỉ ghi mốc, không gửi push). Bản đầu chưa có `driver_name`, `plate`; **đã bổ sung** (mục "BE-7 bổ sung" cuối file).
- **Widget:** zone `order.details.side` có trong `admin-shared` (cùng `before`, `after`, `side.before`, `side.after`). Widget chỉ hiện khi `stage === "PREPARING"` hoặc đã có `delivery`.

**Bằng chứng:** `src/lib/delivery/__tests__/estimate.unit.spec.ts` (7 test), `integration-tests/http/start-delivery.spec.ts` (5 test).

## BE-8 — API hoàn tiền VNPAY (đọc tài liệu sandbox)

**Nguồn:** `https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html` ("API truy vấn (querydr) và hoàn tiền (refund) giao dịch"; link lấy từ trang `docs/thanh-toan-pay/pay.html`, mục lục `/apis/` không liệt kê). Trang cũ `docs/hoantien/refund.html` vẫn 404. Thuật toán băm: `docs/chuyen-doi-thuat-toan/changeTypeHash.html`. Đọc ngày 2026-10-28; **chưa gọi thử sandbox thật** (cần `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` thật).

**Endpoint:** `POST https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`, `Content-Type: application/json`, body JSON phẳng.

**Tham số request** (tất cả bắt buộc trừ `vnp_TransactionNo`):

| Tham số | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `vnp_RequestId` | chữ-số [1,32] | Mã yêu cầu hoàn do merchant sinh, **không trùng trong ngày** |
| `vnp_Version` | [1,8] | `2.1.0` |
| `vnp_Command` | [1,16] | `refund` |
| `vnp_TmnCode` | [8] | Mã merchant |
| `vnp_TransactionType` | số | `02` hoàn toàn phần, `03` hoàn một phần |
| `vnp_TxnRef` | [1,100] | Mã giao dịch của merchant gửi lúc thanh toán (`txn_ref` của ta) |
| `vnp_Amount` | số [1,12] | Số tiền hoàn, ≤ số tiền giao dịch gốc (tài liệu không ghi ×100 riêng cho refund; ta dùng ×100 như `pay`, **chưa kiểm**) |
| `vnp_OrderInfo` | [1,255] | Mô tả lý do hoàn |
| `vnp_TransactionNo` | số [1,15] | Tuỳ chọn: mã giao dịch VNPAY của lần thanh toán gốc (`vnp_TransactionNo` trong IPN) |
| `vnp_TransactionDate` | 14 số | `yyyyMMddHHmmss` GMT+7, **bằng `vnp_CreateDate` của request `pay` gốc** (không phải `vnp_PayDate`) |
| `vnp_CreateBy` | [1,245] | Tên người tạo yêu cầu hoàn |
| `vnp_CreateDate` | 14 số | Thời điểm tạo yêu cầu hoàn, GMT+7 |
| `vnp_IpAddr` | [7,45] | IP máy chủ gọi API |
| `vnp_SecureHash` | [32,256] | Chữ ký |

**Cách ký request:** nối giá trị (không có tên khoá) bằng ký tự `|` theo đúng thứ tự
`vnp_RequestId | vnp_Version | vnp_Command | vnp_TmnCode | vnp_TransactionType | vnp_TxnRef | vnp_Amount | vnp_TransactionNo | vnp_TransactionDate | vnp_CreateBy | vnp_CreateDate | vnp_IpAddr | vnp_OrderInfo`,
rồi `HMAC-SHA512(hashSecret, chuỗi)` ra hex chữ thường (v2.1.0 dùng HMACSHA512; mẫu code UTF-8, hex thường). **Khác** chữ ký của `pay` (đó là `key=value` sắp xếp, nối `&`, mã hoá URL). Trang không nói giá trị rỗng của `vnp_TransactionNo` xử lý ra sao; ta giữ ô rỗng giữa hai dấu `|`.

**Response:** `vnp_ResponseId`, `vnp_Command`, `vnp_TmnCode`, `vnp_TxnRef`, `vnp_Amount`, `vnp_OrderInfo`, `vnp_ResponseCode`, `vnp_Message`, `vnp_BankCode`, `vnp_PayDate`, `vnp_TransactionNo` (mã giao dịch hoàn của VNPAY), `vnp_TransactionType`, `vnp_TransactionStatus`, `vnp_SecureHash`. Chuỗi ký response (cũng nối `|`):
`vnp_ResponseId | vnp_Command | vnp_ResponseCode | vnp_Message | vnp_TmnCode | vnp_TxnRef | vnp_Amount | vnp_BankCode | vnp_PayDate | vnp_TransactionNo | vnp_TransactionType | vnp_TransactionStatus | vnp_OrderInfo`.
Tài liệu ghi sai độ dài một số cột (`vnp_ResponseCode` "[14]", `vnp_OrderInfo` "[2]").

**`vnp_ResponseCode`:** `00` thành công; `02` mã merchant sai; `03` sai định dạng dữ liệu; `91` không tìm thấy giao dịch cần hoàn; `94` đã gửi yêu cầu hoàn cho giao dịch này và VNPAY đang xử lý; `95` giao dịch gốc thất bại bên VNPAY nên từ chối hoàn; `97` sai chữ ký; `99` lỗi khác.
**`vnp_TransactionStatus`** (có thể gặp ở response hoàn): `05` VNPAY đang xử lý hoàn, `06` đã gửi yêu cầu hoàn sang ngân hàng, `09` từ chối hoàn.
**Giới hạn:** tài liệu không nêu thời hạn hoàn; thư viện `vnpay.js.org` ghi hoàn tiền bị VNPAY giới hạn trên sandbox (cần liên hệ VNPAY mở), nên có thể sandbox thật báo lỗi dù code đúng.

**Kết quả đã chạy thật (khách huỷ đơn, `POST /store/orders/:id/cancel`):**
- **`refundPaymentsStep` của Medusa 2.21.1 NUỐT lỗi của provider** (`core-flows/dist/payment/steps/refund-payments.js`: `.catch` chỉ `logger.error("Error was thrown trying to cancel payment ...")`). Hệ quả: `cancelOrderWorkflow` vẫn huỷ đơn, xoá reservation, phát `order.canceled` dù `refundPayment` ném lỗi, tức đơn huỷ mà tiền chưa hoàn. Đã chứng minh: spy `SystemPaymentProvider.prototype.refundPayment` ném lỗi thì route (bản chỉ gọi `cancelOrderWorkflow`) vẫn trả 200. Ném `MedusaError` trong provider (D4) vì vậy **không đủ để dừng việc huỷ**.
- **Cách xử lý:** `customerCancelOrderWorkflow` tự tính phần còn phải hoàn (`captures − refunds` của từng payment), chạy `refundPaymentsWorkflow` (public; `refundCapturedPaymentsWorkflow` không được export), rồi `assertRefundedStep` đọc lại dữ liệu, còn payment chưa hoàn hết thì ném `MedusaError(UNEXPECTED_STATE, ..., "REFUND_FAILED")` **trước** `cancelOrderWorkflow`. Gọi lại sau khi hoàn đã xong thì phần còn phải hoàn bằng 0, không hoàn hai lần. Hạn chế: đơn có nhiều payment mà chỉ một cái hoàn thất bại thì cái kia vẫn đã hoàn (hiện mỗi đơn một payment).
- **Phân loại lỗi trong route:** `run({ throwOnError: false })` trả `errors: [{ action, handlerType, error }]`; `action` là id step lỗi (`validate-order-cancellable`, `use-query-graph-step`) và `error.code` giữ nguyên mã ta gắn. Route trả `409 { code: "ORDER_NOT_CANCELLABLE" }` (sai stage, đã huỷ, còn fulfillment chưa huỷ), `502 { code: "REFUND_FAILED" }`, còn lại ném tiếp (đơn lạ 404). CONFLICT bị error handler ghi đè `code` (BE-4) nên route tự trả JSON.
- **404 cho đơn của người khác:** query `order` lọc theo cả `id` và `customer_id` với `throwIfKeyNotFound`, không lộ việc đơn có tồn tại. Chưa đăng nhập 401 nhờ `authenticate("customer", ["session","bearer"])`.
- **Stage:** workflow không đặt `CANCELLED`; subscriber `order.canceled` (BE-6) đặt, nên response `200 { order: { id, status: "canceled" } }` chưa chắc đã có `metadata.stage = CANCELLED`, storefront đọc lại đơn. Khoá `order-stage-<id>` dùng chung với `setOrderStageWorkflow` để Admin xác nhận không xen vào giữa lúc kiểm stage và huỷ.
- **Còn fulfillment chưa huỷ:** `cancelOrderWorkflow` tự ném `NOT_ALLOWED` (400); ta kiểm trước để trả 409. Test dựng tình huống lệch bằng cách đưa `metadata.stage` về PENDING sau khi tạo fulfillment.
- **Test hoàn tiền không dùng VNPAY:** payment `pp_system_default` rồi `capturePaymentWorkflow`; provider nằm trong container riêng của payment module nên không `container.resolve("pp_system_default")` được, phải spy trên prototype của `SystemPaymentProvider` (`@medusajs/payment/dist/providers/system`).
- **VNPAY `refundPayment`:** lấy `vnp_CreateDate` và số tiền gốc từ `data.payment_url` (URL đã ký của đúng lần thử đã trả), `vnp_TransactionNo` từ `data.vnp_transaction_no` do IPN ghi (BE-5a). Lỗi VNPAY trả `NOT_ALLOWED` kèm mã; lỗi mạng trả `UNEXPECTED_STATE`; cả hai dừng workflow và gây `REFUND_FAILED` ở route.

**Chưa kiểm (cần sandbox thật):** gọi `merchant_webapi/api/transaction` với `VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET` thật; `vnp_Amount` ×100 của refund; ô `vnp_TransactionNo` rỗng trong chuỗi ký; sandbox có bật hoàn tiền cho tài khoản không; chữ ký của response (ta chưa verify, chỉ đọc `vnp_ResponseCode`). Nếu VNPAY trả `97` (sai chữ ký), thử bỏ ô rỗng hoặc đổi `vnp_Amount` rồi ghi kết quả vào mục này.

**Bằng chứng:** `src/modules/vnpay/__tests__/refund-client.unit.spec.ts` (10 test), `service.unit.spec.ts` (5 test refund), `integration-tests/http/customer-cancel.spec.ts` (6 test). Kiểm đột biến: bỏ lọc `customer_id` thì ca "người khác" nhận 200; bỏ `assertRefundedStep` thì ca refund lỗi nhận 200.

## BE-2 — Catalog v2 (2.129 sản phẩm)

**Kết quả đã chạy thật:**
- **`require("./catalog-v2")` nạp nhầm file JSON.** Đặt `catalog-v2.ts` cạnh `catalog-v2.json` thì Node thử `.js`, `.json` trước các đuôi đăng ký thêm như `.ts`, nên `medusa exec` lấy object JSON và báo `loadCatalogV2 is not a function`. Đổi tên loader thành `load-catalog-v2.ts`. JSON đọc bằng `readFileSync` lúc chạy, không `import`, để `tsc` không phải suy kiểu cho file 1,4 MB.
- **Sản phẩm ẩn dùng `ProductStatus.DRAFT`.** Store API và `/store/search` (route tự lọc `status = published`) không trả về, nhưng biến thể vẫn có `sku = catalog_id` để AI tra được. Sản phẩm draft vẫn có tồn kho và giá như thường.
- **Seed chồng lên DB đã có catalog cũ bị lẫn dữ liệu:** seed bỏ qua theo handle và price list "Khuyến mãi tuần" chỉ tạo khi chưa có, nên DB cũ giữ 32 món mẫu và không có giá khuyến mãi của v2. Phải xoá DB rồi seed lại.
- **Tạo theo lô 100 sản phẩm** (`createProductsWorkflow`, `createInventoryLevelsWorkflow` mỗi lô). 2.129 món mất khoảng 15 phút vì mỗi biến thể phát event cho search ingestion; trên DB mới index chưa active nên log có khoảng 12.700 dòng `not_found`, vô hại.
- **Không pipe output của `medusa exec` qua `head`:** khi `head` thoát, tiến trình ghi log bị chặn và seed đứng giữa chừng (đã gặp, dừng ở 1.200 sản phẩm).

**Quyết định:** 11 danh mục cha (8 cũ + `mi-an-lien`, `banh-keo-an-vat`, `dong-lanh-che-bien`), danh mục gốc ở `metadata.subcategory`; mỗi sản phẩm gắn một danh mục cha để FE vẫn đọc `categories[0]`. Nạp đủ 2.129 món, không xoá dòng trùng; `seedCatalog(container, ctx, catalog = DEMO_CATALOG)` nên integration test vẫn dùng 32 món. Combo hiện như sản phẩm thường, trừ CAT-000929 (trang gốc đã mất); bản trùng tên và quy cách thì ẩn, giữ bản AI tham chiếu.

**Bằng chứng:** `tools/catalog/build_catalog_v2.py`, `tools/catalog/hidden-products.md`; seed trên DB dev: 2.129 sản phẩm, 2.126 published, 3 draft, 2.129 inventory level, 24 giá khuyến mãi.

## BE-2c — Khách, admin, đơn demo

**Kết quả đã chạy thật:**
- **`createOrderWorkflow` không nhận `created_at`** (`CreateOrderDTO` không có trường này). Ngày đặt cũ của đơn demo chỉ nằm trong `metadata.stage_log`.
- **Item không truyền `unit_price` thì workflow lấy giá đang tính của biến thể** (`calculated_price.calculated_amount`, gồm price list). Truyền `unit_price` thì thành giá tuỳ chỉnh (`isCustomPrice`). Kiểu `CreateOrderLineItemDTO` bắt buộc `unit_price` nên phải ép kiểu.
- **`markPaymentCollectionAsPaid` chỉ dùng `pp_system_default`** (tạo session, authorize, capture). Provider không cần nằm trong region. Đơn demo vì vậy thanh toán qua provider hệ thống, huỷ đơn demo hoàn tiền qua provider đó.
- **Fulfillment cần reservation** cho biến thể quản kho: `createReservationsWorkflow` với `line_item_id`, rồi `createOrderFulfillmentWorkflow` có `location_id`, `createOrderShipmentWorkflow`, `markOrderFulfillmentAsDeliveredWorkflow`. Đơn tạo bằng `createOrderWorkflow` có `shipping_methods` kèm `shipping_option_id` thì fulfillment chạy được.
- **Ghi `metadata.stage` lúc tạo đơn:** subscriber BE-6 vẫn nhận event fulfillment/shipment/delivery nhưng bước chuyển bị từ chối (cùng stage hoặc lùi) và chỉ `logger.warn`.
- **Khách:** `authService.register("emailpass")` rồi `createCustomerAccountWorkflow({ authIdentityId, customerData })` (workflow tự gắn `customer_id` vào auth identity), `createCustomerAddressesWorkflow`, `linkCustomersToCustomerGroupWorkflow`.
- **Đọc trạng thái đơn:** `fulfillment_status`, `payment_status` là trường tính ra, `query.graph` trả `undefined`; Admin API `GET /admin/orders?fields=...` trả đủ. Store API `/store/customers/me` không trả `groups`.

**Bằng chứng:** `integration-tests/http/seed-demo.spec.ts`; seed trên DB dev: 1 admin, 2 khách, 7 đơn đúng stage.

## BE-7 bổ sung — Tài xế và biển số

- `POST /admin/orders/:id/start-delivery` nhận body `{ driver_name, plate }` (zod, cắt khoảng trắng, 1–100 và 1–20 ký tự) qua `validateAndTransformBody` trong `middlewares.ts`; thiếu hoặc rỗng trả 400 và đơn không đổi. `metadata.delivery` đủ 6 trường của API-7.
- Đã kiểm trên trình duyệt (đơn #6 và #7 của DB dev): ETA = `started_at` + 9 phút cho Quận 7, widget hiện tài xế và biển số.

**Bằng chứng:** `integration-tests/http/start-delivery.spec.ts` (6 test).

## BE-9 — Giỏ "Mua lại" (bản tạm)

- **Số lượng dòng đơn** đọc ở `items.detail.quantity` (như S7).
- **Giá có khuyến mãi qua query:** `product_variant` với `calculated_price.calculated_amount` và `context: { calculated_price: QueryContext({ currency_code: "vnd" }) }`, không cần region.
- **Tồn khả dụng theo biến thể:** helper của chỉ mục tìm kiếm trả theo sản phẩm, không kèm id biến thể, nên tách `availableOf` riêng (`src/lib/inventory/available.ts`), dùng chung với BE-11.
- Middleware `authenticate("customer", ["session","bearer"])` cho `/store/predictive/*`; chưa đăng nhập trả 401.

**Bằng chứng:** `src/lib/predictive/__tests__/reorder.unit.spec.ts` (7 test), `integration-tests/http/reorder-basket.spec.ts`.

## BE-10 — Hợp đồng Trợ lý Bếp

- `recipes_v2.json` của nhóm AI có hai nguyên liệu cùng trỏ về một sản phẩm (`rau om`, `ngò gai` → CAT-001087) và `raw_text` gộp nhiều nguyên liệu; hợp đồng quy định mỗi biến thể chỉ một dòng.
- Route giữ chỗ kiểm body bằng zod rồi trả `501 { code: "IN_DEVELOPMENT" }`; `role: "system"` trong `history` bị từ chối.

**Bằng chứng:** `docs/contracts/assistant-recipes.md`, `integration-tests/http/assistant.spec.ts`.

## BE-11 — Admin

- **Màu:** biến CSS cứng trong `@medusajs/dashboard/dist/app.css` (ví dụ `--bg-interactive: rgba(59, 130, 246, 1)`); `admin-bundler` sinh lại `.medusa/client/index.css` mỗi lần build, file này chỉ import CSS dashboard và Tailwind. Không có cấu hình màu (khẳng định S6). Nhóm chọn chỉ dùng màu Com4Fud trong widget của mình.
- **Ngôn ngữ:** i18next đọc localStorage `lng`, `fallbackLng: "en"`; không đặt mặc định từ server được. `vi.json` thiếu nhóm `layout` (các nút tuỳ chỉnh bố cục); đã bổ sung trong `src/admin/i18n/index.ts` theo dạng `{ vi: { translation: { layout: {...} } } }` và thấy hiện tiếng Việt.
- **Thứ tự widget:** trang danh sách (Đơn hàng, Tồn kho) dùng `LayoutComposer`: phần tử chính được thêm trước, widget nối sau, mọi phần tử có thứ tự 0, nên widget `*.list.before` nằm **dưới** bảng. Người dùng kéo thả ở "Tuỳ chỉnh trang"; bố cục lưu phía server qua `sdk.admin.layouts` (của tôi / mặc định cho mọi người).
- **Zone có sẵn:** `order.list.before`, `inventory_item.list.before`, `product.list.before`… (danh sách đầy đủ trong `admin-shared`).

**Bằng chứng:** `src/lib/dashboard/__tests__/summary.unit.spec.ts` (4 test), `integration-tests/http/dashboard.spec.ts`; đã kiểm trên trình duyệt 29/10.

## BE-12 — Dọn dẹp

- **Lockfile:** `package-lock.json` của commit khởi tạo ghi `dev` cho khoảng 20 gói (`typescript`, `@swc/core`, `@types/react`, `yalc`…) mà npm 10.9.8 (bản repo ghim) và npm 11 đều tính là `devOptional`. Đã commit lock do npm 10.9.8 sinh ra, chỉ đổi cờ, không đổi phiên bản gói.
- **`cross-env`** làm script `test:*` chạy được từ PowerShell/cmd; đã chạy đủ 15 suite integration từ PowerShell mà không đặt `npm_config_script_shell`.

## HS-0 — Spike cho Redis hot-stock

Chạy bằng một test tích hợp tạm (subscribe trực tiếp event bus, catalog 32 món, provider `pp_system_default` và VNPAY với khóa thử), 2026-11-03. File test đã xoá sau khi ghi lại.

**Event tồn kho:**
- Sửa tồn bằng `updateInventoryLevelsWorkflow` phát đúng một `inventory-level.updated { id }` (id inventory level, không kèm item hay location).
- Hoàn tất giỏ phát `order.placed { id }` và `reservation-item.created { id, order_id }`; **không** phát `inventory-level.updated` dù `reserved_quantity` của level tăng. Đồng bộ phần đã giữ phải nghe `reservation-item.*`.
- `cancelOrderWorkflow` phát `order.canceled { id }` và `reservation-item.deleted { id, order_id }`; `reserved_quantity` về 0. Reservation đã xoá vẫn đọc được bằng `query.graph({ ..., withDeleted: true })` (có `inventory_item_id`, `deleted_at`); không có `withDeleted` thì trả rỗng.
- Thứ tự hai event của hoàn tất giỏ không cố định theo nghĩa nghiệp vụ (log thấy `order.placed` trước). Cả hai phát sau khi workflow xong, nên lúc subscriber chạy thì reservation đã có trong Postgres.

**Giỏ, đơn, biến thể:**
- Cart của đơn: `order_cart { order_id, cart_id }`, hoặc `order` với field `cart.id`.
- Biến thể: `manage_inventory`, `inventory_items[].inventory_item_id`, `inventory_items[].required_quantity` (catalog hiện 1 item, `required_quantity = 1`).

**Phiên thanh toán:**
- Tạo phiên VNPAY lần hai cho cùng payment collection thì **phiên cũ bị xoá** (chỉ còn phiên mới, `txn_ref` mới). Khách trả bằng link cũ thì IPN không tìm thấy phiên và trả `01`, tiền đã thu mà không có đơn. Rủi ro có từ trước hot-stock; link 10 phút (D2) thu hẹp nhưng không bỏ được.

**Hoàn tất giỏ khi Postgres thiếu hàng:**
- `POST /store/carts/:id/complete` trả `400 { type: "not_allowed", message: "Not enough stock available for item <iitem> at location <sloc>" }`.
- Qua IPN (thành công): IPN trả `00`, payment được tạo và **captured trước**, rồi hoàn tất giỏ lỗi. Compensation `compensatePaymentIfNeededStep` (`core-flows/dist/cart/steps/compensate-payment-if-needed.js`) tự chạy `refundPaymentAndRecreatePaymentSessionWorkflow`: gọi `refundPayment` của provider (VNPAY refund API) rồi tạo lại phiên thanh toán mới, nên phiên cũ không còn. Bỏ qua hoàn tiền nếu giỏ đã có đơn.
- Hoàn tiền lỗi thì **chỉ ghi log** (`Error was thrown trying to cancel payment ... VNPAY refund rejected (code 99)` với khóa thử), không ném lỗi: payment vẫn captured, không đơn, giỏ chưa hoàn tất, không ai được báo. Dòng nhật ký "refund trả 99" trong plan `2026-10-18` có lẽ đến từ đường này với khóa thử.

**Module, job, build:**
- Module service có `__hooks: { onApplicationStart, onApplicationShutdown, onApplicationPrepareShutdown }` (`@medusajs/types` modules-sdk) để mở và đóng kết nối Redis.
- Scheduled job: file trong `src/jobs` export hàm `(container)` và `config { name, schedule (cron), numberOfExecutions? }`.
- `medusa build` chỉ biên dịch TypeScript và chép file package (`framework/dist/build-tools/compiler.js`), **không chép `.lua`**. Script Lua phải nằm trong file `.ts` (chuỗi hằng).

**Quyết định cho plan hot-stock:** đồng bộ nghe `inventory-level.*` và `reservation-item.*`, đọc bản đã xoá bằng `withDeleted`; Lua nhúng trong `.ts`; nhánh hết hàng của D4 vẫn phải tự hoàn tiền vì ở thời điểm đó Postgres còn hàng (món chỉ đang được giữ trong Redis) nên Medusa không tự hoàn; IPN của phiên đã bị thay ghi nhận là rủi ro.
