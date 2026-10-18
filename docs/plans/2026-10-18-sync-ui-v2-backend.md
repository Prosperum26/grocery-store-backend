# Sync giao diện v2 (xương) + palette v1 (xanh lá): phần Backend

> **Cho người làm tiếp:** làm lần lượt từng task, tick `- [ ]` khi xong, ghi commit hash vào cột "Trạng thái" ở bảng đầu file. Mỗi task độc lập đủ để merge riêng, nên có thể dừng giữa chừng. Đọc kèm bản FE: `grocery-store-frontend/docs/plans/2026-10-18-sync-ui-v2-frontend.md` (hai file chung các mục 1, 2, 3, 4).
>
> Quy ước backend (Medusa v2.21.1) ở `AGENTS.md` của repo này vẫn là ưu tiên: logic nằm trong workflow/module, route chỉ gọi workflow, không raw SQL, sửa model thì `medusa db:generate`. **Đừng đoán API Medusa từ trí nhớ**, tra docs (MCP `medusa`) trước khi viết mỗi task. Lệnh test: `cd apps/backend && npm run test:integration:http`.

**Mục tiêu:** làm cho dữ liệu và API của Medusa đủ để storefront mới (khung xương Figma v2) chạy được từ đầu đến cuối.
**Nguồn thiết kế:** `Com4Fud_UI_SVG/v2/` (README, `preview_png/`, dữ liệu mẫu `v2/_source/src/shared.js`). Đây là 2026-10-18, repo đang ở nhánh `feature/sync-figma-ui`.

## 0. Bảng trạng thái

| Task | Nội dung | Ưu tiên | Phụ thuộc | Trạng thái |
| :--- | :--- | :---: | :--- | :--- |
| BE-1 | Region VND, kho Q.7, tắt dữ liệu mẫu áo quần | P0 | | [ ] |
| BE-2 | Seed catalog thực phẩm + khách demo + đơn demo | P0 | BE-1 | [ ] |
| BE-3 | Tìm kiếm/lọc: `in_stock`, `on_sale_vnd`, đúng category | P0 | BE-2 | [ ] |
| BE-4 | Khung giờ giao (`/store/delivery-slots`) + phí giao | P1 | BE-1 | [ ] |
| BE-5 | Thanh toán chỉ VNPAY (provider tạm) + mã `TUOI20` | P1 | BE-1 | [ ] |
| BE-6 | Trạng thái đơn `metadata.stage` + subscriber | P1 | BE-2 | [ ] |
| BE-7 | Bắt đầu giao: workflow + widget Admin + ước giờ tới | P1 | BE-6 | [ ] |
| BE-8 | Khách tự hủy đơn khi còn "Chờ xác nhận" | P2 | BE-6 | [ ] |
| BE-9 | Stub `reorder-basket` và `warm` | P2 | BE-2 | [ ] |
| BE-10 | Hợp đồng Trợ lý Bếp / Công thức (chỉ kiểu dữ liệu + fixture) | P2 | | [ ] |
| BE-11 | Admin: Việt hóa, widget Tổng quan, widget Sắp cạn kho | P3 | BE-2 | [ ] |
| BE-12 | Dọn dẹp, cập nhật `.env.template`, README | P3 | tất cả | [ ] |

P0 = FE không chạy được nếu thiếu. P1 = luồng mua hàng đầy đủ. P2/P3 = có thể để sau, FE có fixture thay thế.

## 1. Bối cảnh và những gì đã chốt

**Chốt (2026-10-18, nhóm):** lấy **bố cục và thành phần của v2**, nhưng **giữ bộ màu xanh lá của v1**. Bảng màu đỏ-xanh của v2 bị bỏ. Chi tiết token ở bản FE (backend không cần màu), backend chỉ cần biết rằng **tên màu v2 (`red` = hành động mua) không còn đúng nữa**: FE đặt tên theo vai trò (`brand`, `accent`, `sale`, `warn`).

Từ v2 cần backend hỗ trợ (đã đối chiếu với `v2/README.md` và các `pages_*.js`):

| Thay đổi ở UI v2 | Hệ quả cho backend |
| :--- | :--- |
| Tiếng Việt thuần, tiền VND (`395.000đ`) | Region `vn`, currency `vnd`, tên sản phẩm/danh mục tiếng Việt |
| Bộ lọc chỉ còn "Chỉ hiện còn hàng" và "Đang giảm giá" + danh mục + sắp xếp | Index tìm kiếm cần field `in_stock` và giá `vnd` (hiện chỉ có `eur`, `usd`) |
| Thẻ sản phẩm: tem `−12%`, "Hết hàng", quy cách, xuất xứ, "Còn 3 khay" | Metadata sản phẩm + `inventory_quantity` + giá gốc/giá bán |
| Chi tiết: chọn quy cách (khay 300g/500g/1kg), cách sơ chế, "Thường mua kèm" | Variant theo quy cách; sơ chế là metadata dòng giỏ (không nhân biến thể); thường mua kèm lấy từ `metadata.companions` |
| Giỏ: dòng "vừa hết hàng", "giá vừa đổi 89.000đ lên 92.000đ", khối "Có thể bạn cần mua lại" | Cần biết giá lúc thêm vào giỏ (FE tự so), tồn kho realtime, API `reorder-basket` |
| Thanh toán: chọn khung giờ giao có phí khác nhau, ghi chú cho tài xế, **chỉ VNPAY** | Shipping option theo khung giờ, `cart.metadata.delivery_note`, một provider thanh toán |
| Đơn hàng: trạng thái dạng vé (Chờ xác nhận, Đã xác nhận, Đang chuẩn bị, Đang giao, Đã giao, Đã hủy) | Ánh xạ sang trạng thái Medusa (đóng Q5 ở `docs/06`), xem BE-6 |
| Theo dõi đơn **không có bản đồ**: thẻ "Dự kiến tới lúc 17:35 · còn 2,4 km" + mẫu thông báo | Khi tài xế bắt đầu giao, backend tính quãng đường, ước giờ, ghi vào đơn (BE-7) |
| Trợ lý Bếp, Công thức vào giỏ | Hợp đồng API (BE-10); phần AI làm ở repo `grocery-store-ai`, **ngoài phạm vi sync** |
| Admin: Tổng quan, Sản phẩm, Tồn kho, Đơn hàng | Dùng Medusa Admin + widget, không dựng app admin riêng (đã chốt ở `docs/07`) |

**Hiện trạng backend (2026-10-18):** scaffold Medusa 2.21.1; seed (`src/migration-scripts/initial-data-seed.ts`) là **áo quần châu Âu** (region Europe, eur/usd, kho "European Warehouse"); `src/scripts/seed-demo-products.ts` tạo 50 sản phẩm áo quần; `src/search/product.ts` có index tìm kiếm với `on_sale_eur/usd` nhưng **`medusa-config.ts` chưa khai báo module search nào**; chưa có custom module, workflow, subscriber, route nào ngoài `custom/route.ts` mẫu.

## 2. Quy ước chung cho dữ liệu (cả FE và BE phải khớp)

- **Tiền:** Medusa v2 lưu số tiền theo đơn vị chính, `vnd` không chia 100. FE đã có `noDivisionCurrencies` chứa `vnd`.
- **Danh mục (8, handle cố định):** `rau-cu` Rau củ, `trai-cay` Trái cây, `thit` Thịt, `hai-san` Hải sản, `trung-sua` Trứng & Sữa, `gao-do-kho` Gạo & Đồ khô, `gia-vi` Gia vị, `do-uong` Đồ uống.
- **Metadata sản phẩm:** `art` (khóa minh họa, vd `"fishFillet"`), `tint` (`red|orange|green|cream|blue|yellow|brown|pink`, màu đĩa nền), `origin` (vd `"Đồng Tháp"`, tùy chọn), `stock_unit` (`"khay"`, dùng cho "Còn 3 khay"), `low_stock` (số, ngưỡng hiện "Còn N", mặc định 10), `prep_options` (mảng chuỗi, tùy chọn: `["Phi lê nguyên miếng","Cắt khúc nấu canh","Cắt lát mỏng"]`), `companions` (mảng handle, "Thường mua kèm").
- **Biến thể:** `title` là quy cách hiển thị ("Khay 500g"), `weight` tính bằng gam (FE tính "170.000đ/kg" từ đây), có một option tên `Quy cách`.
- **Dòng giỏ:** `metadata.prep` (chuỗi, một trong `prep_options`), `metadata.price_at_add` (số, giá lúc thêm, để hiện "giá vừa đổi từ 89.000đ lên 92.000đ"; do FE ghi).
- **Giỏ:** `metadata.delivery_note` (≤200 ký tự), `metadata.slot` (id khung giờ).
- **Đơn:** `metadata.stage`, `metadata.stage_log`, `metadata.delivery` (mục API-5, API-7).

## 3. Hợp đồng API (nguồn sự thật cho cả hai bên)

Mọi route `/store/*` cần `x-publishable-api-key`; route của khách cần thêm JWT. **Nếu đổi hình dạng response, sửa mục này ở cả hai file kế hoạch.**

| ID | Route | Trạng thái | Response / ghi chú |
| :--- | :--- | :--- | :--- |
| API-1 | `GET /store/products` | Medusa | Thêm `fields=+metadata,+variants.inventory_quantity,+variants.weight`. FE tính giá gốc/giá bán từ `calculated_price`. |
| API-2 | `POST /store/search` | Medusa Search (cấu hình ở BE-3) | Lọc `category`, `in_stock: true`, `on_sale_vnd: true`; sắp xếp. Hình dạng body chốt ở BE-3 rồi ghi lại tại đây. |
| API-3 | `GET /store/predictive/reorder-basket` | Mới (stub ở BE-9) | `{ status: "ready"\|"warming"\|"empty", items: [{ variant_id, product_id, title, unit_label, art, tint, quantity, unit_price, in_stock }], total }`. **Không** trả xác suất, chu kỳ, lý do. |
| API-3b | `POST /store/predictive/warm` | Mới (stub ở BE-9) | `202 {}`; không chờ. |
| API-4 | `GET /store/delivery-slots?cart_id=` | Mới (BE-4) | `{ slots: [{ id, label, day_label, shipping_option_id, fee, closed, note }] }`. FE chọn slot rồi thêm shipping method thường với `option_id = shipping_option_id`. |
| API-5 | `order.metadata` | Mới (BE-6) | `stage`: `PENDING\|CONFIRMED\|PREPARING\|SHIPPING\|DELIVERED\|CANCELLED`; `stage_log`: `[{ stage, at }]` (ISO). FE đọc trực tiếp, **không tự suy ra** từ trạng thái Medusa. |
| API-6 | `POST /store/orders/:id/cancel` | Mới (BE-8) | `200 { order }`; `409` nếu `stage != PENDING`. |
| API-7 | `order.metadata.delivery` | Mới (BE-7) | `{ driver_name, plate, distance_km, eta_at, started_at, notice_sent_at }`; chỉ có từ lúc `SHIPPING`. |
| API-8 | `POST /store/recipes/semantic-search`, `POST /store/assistant/chat` | Hợp đồng ở BE-10, cài đặt thật ở repo AI | Xem kiểu `Recipe`, `MealPlan`, `AssistantReply` ở BE-10. |
| API-9 | `GET /admin/dashboard/summary` | Mới (BE-11) | `{ revenue_today, orders_today, aov, low_stock_count, revenue_7d: number[] }`. |

**Ánh xạ trạng thái đơn (đề xuất để đóng Q5 ở `docs/06`):**

| `stage` (UI) | Điều kiện Medusa | Nguồn sự kiện |
| :--- | :--- | :--- |
| `PENDING` Chờ xác nhận | Đơn vừa đặt, chưa thanh toán xong | `order.placed` |
| `CONFIRMED` Đã xác nhận | Thanh toán thành công (`payment.captured`) | `payment.captured` |
| `PREPARING` Đang chuẩn bị | Fulfillment được tạo | `order.fulfillment_created` |
| `SHIPPING` Đang giao | Shipment được tạo | `shipment.created` |
| `DELIVERED` Đã giao | Fulfillment được đánh dấu đã giao | `delivery.created` |
| `CANCELLED` Đã hủy | Đơn bị hủy | `order.canceled` |

(Tên event ở cột cuối là theo tài liệu Medusa tại thời điểm viết. **Kiểm tra lại danh sách event của v2.21.1 ở BE-6 trước khi code**, vì có thể khác tên.)

## 4. Câu hỏi mở (hỏi nhóm trước khi làm task liên quan)

| # | Câu hỏi | Task bị chặn | Mặc định nếu chưa có trả lời |
| :--- | :--- | :--- | :--- |
| O1 | Dữ liệu mẫu ghi "Phí giao 15.000đ" cho đơn 395.000đ, nhưng trang chủ có băng "Miễn phí giao từ 300.000đ". Hai điều này mâu thuẫn. | BE-4 | Bỏ băng "miễn phí từ 300.000đ" (sửa cả FE), giữ phí theo khung giờ. |
| O2 | Thông báo đẩy thật (web push) có làm không? Thiết kế chỉ có mẫu thông báo. | BE-7 | Không. Ghi `notice_sent_at`, FE hiện băng thông báo trên trang theo dõi đơn khi mở lại. |
| O3 | Thiết kế có điểm đánh giá "4,8 · 312 đánh giá", nút tim yêu thích và "Báo khi có hàng". Medusa không có sẵn. | BE-2 | Không làm; FE ẩn. Quy tắc dự án là chỉ hiện điều chắc chắn. |
| O4 | Trợ lý Bếp có thẻ "Nhà bạn đang có" (loại trừ đồ sẵn có) nhưng MVP Recipe RAG **đã cắt** tính năng này (`memory: recipe-rag-mvp-decisions`). | BE-10 | FE ẩn thẻ này cho đến khi AI hỗ trợ. |
| O5 | Khoảng cách/ước giờ tính bằng gì khi chưa có geocoding? | BE-7 | Bảng khoảng cách cố định theo phường/quận từ Kho Q.7, tốc độ giả định 20 km/h. Giải thích được từng dòng. |
| O6 | `POST /store/search` cần provider nào (Meilisearch, v.v.)? Chưa cấu hình. | BE-3 | Spike ở BE-3; nếu cần dịch vụ ngoài thì dùng phương án dự phòng (route `GET /store/catalog`). |

---

## Task BE-1: Region VND, kho Q.7, bỏ dữ liệu áo quần

**Files:**
- Modify: `apps/backend/src/migration-scripts/initial-data-seed.ts` (hiện: Europe, eur/usd, "European Warehouse", 7 nước)
- Modify: `apps/backend/.env.template` (không đụng `.env`)

**Xong khi:** `npx medusa exec ./src/migration-scripts/initial-data-seed.ts` trên DB trống tạo ra region `Việt Nam` (`vnd`, country `vn`), kho `Kho Q.7`, sales channel và publishable key; `GET /store/regions` trả đúng một region `vnd`.

- [ ] Tra docs Medusa về `createRegionsWorkflow`, stock location, fulfillment set; sửa seed: store `supported_currencies` chỉ `vnd` (default), region `Việt Nam`, tax region `vn`.
- [ ] Đổi tên kho thành `Kho Q.7`, địa chỉ Quận 7, TP.HCM; fulfillment set + service zone `Nội thành TP.HCM` (geo_zone `vn`).
- [ ] Bỏ category/product áo quần khỏi seed này (BE-2 thay thế). Xóa `src/scripts/seed-demo-products.ts` ở BE-12, chưa xóa ở đây.
- [ ] Ghi vào `.env.template` biến mới nếu có (chưa có biến nào bắt buộc ở task này).
- [ ] Đề xuất commit: `feat(seed): vnd region and Kho Q.7 stock location`

## Task BE-2: Seed catalog thực phẩm, khách demo, đơn demo

**Files:**
- Create: `apps/backend/src/scripts/data/grocery-catalog.ts` (dữ liệu thuần, xuất `GROCERY_PRODUCTS`, `DEMO_CUSTOMER`, `DEMO_ORDERS`)
- Create: `apps/backend/src/scripts/seed-grocery.ts` (chạy bằng `medusa exec`, idempotent theo handle như `seed-demo-products.ts` hiện tại)
- Nguồn dữ liệu: `Com4Fud_UI_SVG/v2/_source/src/shared.js` (bảng `prod(...)`, `CART`, `ORDERS`, `USER`)

**Xong khi:** chạy script hai lần liên tiếp, lần hai không tạo trùng; `GET /store/products?limit=100` trả 23 sản phẩm; tôm thẻ có tồn 0; thịt ba rọi có giá bán 92.000đ và giá gốc 105.000đ; khách `minhthu@com4fud.demo` đăng nhập được và có 5 đơn khớp bảng `ORDERS`.

- [ ] Port 23 sản phẩm từ `shared.js` sang `GROCERY_PRODUCTS`: `handle` slug không dấu (`ca-loc-phi-le`), `title`, category theo handle ở mục 2, metadata theo mục 2, tồn kho vào level của `Kho Q.7`, `low_stock` riêng cho cá lóc là 5.
- [ ] Quy cách: cá lóc có 3 biến thể (`Khay 300g` 52.000, `Khay 500g` 85.000, `Khay 1 kg`, tồn 0); các món còn lại 1 biến thể lấy từ `unit` của `shared.js`. Điền `weight` (gam) cho món bán theo khối lượng.
- [ ] Giảm giá: dùng price list (giá bán < giá gốc) cho bông cải, thịt ba rọi. Kiểm tra bằng `calculated_price.original_amount` khác `calculated_amount`.
- [ ] Gán `metadata.companions` (cá lóc: cà chua, dứa, me chua, rau om) để trang chi tiết có "Thường mua kèm".
- [ ] Tạo khách demo (`DEMO_CUSTOMER`, auth `emailpass`), 1 admin demo `hoangnam@com4fud.demo`. **Mật khẩu demo đọc từ biến môi trường `DEMO_PASSWORD`, thêm vào `.env.template`, không viết cứng trong repo.**
- [ ] Tạo 5 đơn demo bằng workflow đơn hàng (không insert thẳng DB), mã hiển thị khớp `C4F-261007-0142` nếu `custom_display_id` cho phép; nếu không, ghi `metadata.code`. Trạng thái giữ nguyên mỗi đơn (SHIPPING, DELIVERED ×3, CANCELLED); `stage` do BE-6 đặt, nên task này chỉ tạo đơn rồi BE-6 có bước backfill.
- [ ] Test: `integration-tests/http/catalog.spec.ts` kiểm tra số lượng, tồn kho tôm = 0, thịt ba rọi `original_amount=105000`.
- [ ] Đề xuất commit: `feat(seed): grocery catalog and demo customer/orders`

## Task BE-3: Tìm kiếm và lọc (Còn hàng, Đang giảm giá)

**Files:**
- Modify: `apps/backend/medusa-config.ts` (khai báo module search nếu cần)
- Modify: `apps/backend/src/search/helpers/pricing.ts:11` (`PRICE_CURRENCIES = ["eur","usd"]` → `["vnd"]`)
- Modify: `apps/backend/src/search/product.ts` (thêm field `in_stock`, `art`, `tint`)
- Modify: `apps/backend/src/api/middlewares.ts` (đã có `configureStoreSearch`)

**Xong khi:** `POST /store/search` với filter `category: "Rau củ"` + `in_stock: true` + `on_sale_vnd: true` trả đúng tập con; sửa tồn kho một sản phẩm về 0 thì nó biến khỏi kết quả `in_stock` sau khi reindex.

- [ ] **Spike trước (≤1 giờ):** `/store/search` có chạy được với cấu hình hiện tại không, và cần provider nào? Ghi kết luận vào mục O6. Nếu cần dịch vụ ngoài (Meilisearch...), quyết định cùng nhóm: hoặc thêm vào Docker Compose, hoặc chuyển sang phương án dự phòng `GET /store/catalog` (route tự viết, `query.graph` + lọc theo tồn kho và giá), đổi dòng API-2 tương ứng.
- [ ] Đổi `PRICE_CURRENCIES` sang `["vnd"]`; FE có hằng `SEARCH_PRICE_CURRENCIES` tương ứng (ghi chú trong comment của `pricing.ts`), phải đổi cùng lúc.
- [ ] Thêm `in_stock: search.boolean().filterable()`; giá trị lấy từ tổng `inventory_quantity` của các biến thể > 0. Thêm event `inventory-level.updated` vào `PRODUCT_EVENTS` để chỉ mục cập nhật khi tồn thay đổi (kiểm tra tên event trong docs v2.21.1).
- [ ] Test http: ba tổ hợp bộ lọc ở trên + sắp xếp theo giá.
- [ ] Cập nhật dòng API-2 ở mục 3 (cả hai file) bằng body request/response thật.
- [ ] Đề xuất commit: `feat(search): vnd prices and in_stock filter`

## Task BE-4: Khung giờ giao và phí giao

**Files:**
- Create: `apps/backend/src/api/store/delivery-slots/route.ts` (GET)
- Create: `apps/backend/src/workflows/list-delivery-slots.ts`
- Modify: `apps/backend/src/scripts/seed-grocery.ts` (tạo shipping option mỗi khung giờ)

**Interfaces:** Produces `GET /store/delivery-slots` theo API-4. Slot mẫu từ thiết kế: Hôm nay 15:00–17:00 (đã đóng), 17:00–19:00 (+15.000đ), 19:00–21:00 (miễn phí), Mai 07:00–09:00 (miễn phí).

**Xong khi:** gọi route lúc 16:00 thì slot 15:00–17:00 có `closed: true`; slot còn lại trả `shipping_option_id` thêm được vào giỏ qua API Medusa.

- [ ] Quyết định O1 trước khi seed phí.
- [ ] Mỗi khung giờ là một shipping option với `price_type: flat`; id slot = `metadata.slot_id` của option. Route chỉ đọc option của cart và tính `closed` từ giờ hiện tại (giờ máy chủ, múi `Asia/Ho_Chi_Minh`), không viết SQL.
- [ ] Test http với đồng hồ giả (inject hàm `now()` qua tham số workflow, không dùng `Date.now()` trực tiếp trong step).
- [ ] Đề xuất commit: `feat(shipping): delivery slot listing`

## Task BE-5: Chỉ VNPAY và mã giảm giá TUOI20

**Files:**
- Modify: `apps/backend/medusa-config.ts` (payment providers)
- Modify: `apps/backend/src/scripts/seed-grocery.ts` (gắn provider vào region, tạo promotion)

**Xong khi:** `GET /store/payment-providers?region_id=` chỉ trả **một** provider; áp mã `TUOI20` vào giỏ 395.000đ + phí giao 15.000đ cho tổng 390.000đ.

- [ ] VNPAY thật là việc riêng (chưa có, xem `AGENTS.md` gốc). Ở task này dùng provider tạm `pp_system_default` làm "VNPAY thử nghiệm", để FE hiển thị nhãn **"Thanh toán qua VNPAY"**. Ghi rõ trong comment: thay bằng provider VNPAY khi module thanh toán xong. ID provider được dùng ở FE: xem FE-8.
- [ ] Tắt Stripe/PayPal khỏi region (không đăng ký).
- [ ] Promotion `TUOI20`: fixed 20.000 VND, áp trên đơn.
- [ ] Test http: tổng giỏ mẫu = 390.000 (khớp `verify()` trong `shared.js`).
- [ ] Đề xuất commit: `feat(payment): single VNPAY placeholder provider and TUOI20 promo`

## Task BE-6: Trạng thái đơn `metadata.stage`

**Files:**
- Create: `apps/backend/src/workflows/set-order-stage.ts` (workflow + step `setOrderStageStep`)
- Create: `apps/backend/src/subscribers/order-stage-*.ts` (một subscriber mỗi event, mỗi file gọi đúng workflow trên)
- Create: `apps/backend/src/scripts/backfill-order-stage.ts`

**Interfaces:** Produces `setOrderStageWorkflow(input: { order_id: string; stage: OrderStage; at?: string }): void`. Ghi `metadata.stage` và nối vào `metadata.stage_log`. `OrderStage = "PENDING"|"CONFIRMED"|"PREPARING"|"SHIPPING"|"DELIVERED"|"CANCELLED"` (định nghĩa trong `src/lib/order-stage.ts`, FE sao chép kiểu này).

**Xong khi:** tạo đơn mới, thanh toán, tạo fulfillment, shipment, giao xong thì `stage` đi đúng thứ tự và `stage_log` có đủ 5 mốc; chuyển ngược (vd `DELIVERED` rồi lại `PREPARING`) bị từ chối.

- [ ] Tra danh sách event v2.21.1 (bảng ánh xạ mục 3). Nếu tên khác, sửa bảng.
- [ ] Test unit cho hàm thuần `canTransition(from, to)`; test http cho chuỗi sự kiện.
- [ ] Script backfill đặt `stage` cho 5 đơn demo của BE-2 theo `ORDERS` (SHIPPING, DELIVERED ×3, CANCELLED) và `stage_log` khớp `TIMELINE` trong `shared.js` (15:12, 15:14, 16:20, 17:02).
- [ ] Đóng Q5 trong `docs/06-decisions-and-open-questions.md` (thư mục gốc, nội bộ).
- [ ] Đề xuất commit: `feat(orders): stage metadata and transition subscribers`

## Task BE-7: Bắt đầu giao, ước giờ tới, widget Admin

**Files:**
- Create: `apps/backend/src/workflows/start-delivery.ts`
- Create: `apps/backend/src/lib/delivery-estimate.ts` (hàm thuần `estimateDelivery(districtOrWard: string, now: Date): { distance_km: number; eta_at: string }`)
- Create: `apps/backend/src/api/admin/orders/[id]/start-delivery/route.ts` (POST `{ driver_name, plate }`)
- Create: `apps/backend/src/admin/widgets/order-delivery.tsx` (zone `order.details.side.after`)

**Interfaces:** Consumes `setOrderStageWorkflow` (BE-6). Produces `metadata.delivery` theo API-7.

**Xong khi:** từ Admin bấm "Bắt đầu giao" trên đơn đang `PREPARING`, nhập tên tài xế và biển số; đơn chuyển `SHIPPING`, có `delivery.eta_at` và `distance_km`; `notice_sent_at` được ghi (tức là "thông báo đã gửi").

- [ ] Quyết định O5 và O2. Bảng khoảng cách phường/quận → km nằm ngay trong `delivery-estimate.ts`, kèm comment nguồn. Ví dụ thiết kế: Sky Garden, Q.7, 2,4 km, tới 17:35.
- [ ] Test unit `estimateDelivery` (ví dụ ở trên cho kết quả đúng; địa chỉ lạ dùng giá trị mặc định có cảnh báo, không ném lỗi).
- [ ] Workflow: tạo shipment qua workflow lõi của Medusa, rồi đặt `stage = SHIPPING`, ghi `delivery`; có compensation (hoàn lại `stage`) khi bước tạo shipment lỗi.
- [ ] Widget: form 2 ô + nút; chỉ hiện khi `stage === "PREPARING"`. Tra docs admin-sdk trước khi viết.
- [ ] Đề xuất commit: `feat(delivery): start-delivery workflow with ETA and admin widget`

## Task BE-8: Khách tự hủy đơn

**Files:**
- Create: `apps/backend/src/api/store/orders/[id]/cancel/route.ts`
- Create: `apps/backend/src/workflows/customer-cancel-order.ts`

**Xong khi:** gọi lúc `stage=PENDING` trả 200 và đơn sang `CANCELLED`; lúc `CONFIRMED` trở đi trả 409; đơn của khách khác trả 404.

- [ ] Workflow bọc `cancelOrderWorkflow` của Medusa, kiểm tra quyền sở hữu và `stage`.
- [ ] Test http cho 3 trường hợp trên.
- [ ] Đề xuất commit: `feat(orders): customer cancel while pending`

## Task BE-9: Stub `reorder-basket` và `warm`

**Files:**
- Create: `apps/backend/src/api/store/predictive/reorder-basket/route.ts`, `apps/backend/src/api/store/predictive/warm/route.ts`
- Create: `apps/backend/src/workflows/get-reorder-basket.ts`

**Xong khi:** khách demo gọi `reorder-basket` nhận 5 món tổng 343.000đ (khớp `PREDICT_TOTAL`); khách chưa có đơn nhận `status: "empty"`; món hết hàng có `in_stock: false`.

- [ ] **Đây là bản tạm cho giao diện, không phải module Predictive.** Cài đơn giản, giải thích được: đếm tần suất mua theo biến thể trong các đơn `DELIVERED` của khách, lấy 5 món đầu. Comment đầu file nói rõ sẽ bị thay bằng module Predictive (LightGBM) và hợp đồng response giữ nguyên.
- [ ] `warm` trả 202 và không làm gì.
- [ ] Test http theo ba ca trên.
- [ ] Đề xuất commit: `feat(predictive): stub reorder-basket for UI`

## Task BE-10: Hợp đồng Trợ lý Bếp / Công thức

**Files:**
- Create: `apps/backend/src/types/assistant.ts`
- Create: `docs/contracts/assistant-recipes.md` (ví dụ JSON, dùng chung với FE)

**Interfaces:** Produces các kiểu `Recipe { slug; name; serves: number; time_minutes: number; steps: string[]; ingredients: RecipeIngredient[]; buy_total: number }`, `RecipeIngredient { need_text: string; variant_id: string; title: string; unit_label: string; quantity: number; unit_price: number; have?: boolean; alternatives?: { variant_id; title; brand; unit_label; unit_price }[] }`, `MealPlan { meals: { day: string; dish: string; need_variant_ids: string[] }[]; basket: { items: RecipeIngredient[]; total: number } }`, `AssistantReply { text: string; plan?: MealPlan; recipe?: Recipe }`.

**Xong khi:** hai file được duyệt; ví dụ JSON dùng đúng số liệu mẫu (canh chua cá lóc 6 nguyên liệu cần mua 161.000đ; 3 bữa, 11 món, 232.000đ; cà chua mua một lần cho hai món).

- [ ] Không có điểm khớp, nguồn dữ liệu, thời gian trả lời, kcal trong kiểu (theo quy tắc "chỉ hiện điều chắc chắn"). Nếu nhóm muốn kcal, thêm `kcal?: number` sau.
- [ ] Theo `memory/recipe-rag-mvp-decisions`: số lượng theo phương án **mua dư**, catalog là nguồn duy nhất. Hợp đồng chỉ mang `quantity` đã làm tròn.
- [ ] Gửi file hợp đồng cho người làm repo AI; việc cài đặt route là task của họ.
- [ ] Đề xuất commit: `docs(contracts): assistant and recipe types`

## Task BE-11: Admin (Việt hóa, Tổng quan, Sắp cạn kho)

**Files:**
- Modify: `apps/backend/src/admin/i18n/index.ts`
- Create: `apps/backend/src/admin/widgets/dashboard-summary.tsx` (zone `product.list.before` hoặc trang chủ nếu v2.21.1 hỗ trợ; tra docs)
- Create: `apps/backend/src/api/admin/dashboard/summary/route.ts`
- Create: `apps/backend/src/admin/widgets/low-stock.tsx`

**Xong khi:** Admin hiện tiếng Việt cho các nhãn chính; widget Tổng quan hiện doanh thu hôm nay, số đơn, giá trị đơn trung bình, số món sắp cạn, biểu đồ 7 ngày; dữ liệu khớp API-9.

- [ ] Quyết định: **không dựng lại** trang Sản phẩm/Tồn kho/Đơn hàng kiểu Kanban của v2; Medusa Admin đã có. Chỉ làm hai widget trên. Ghi lại lựa chọn này vào `docs/07-ui-design.md` (gốc).
- [ ] Biểu đồ dự báo nhu cầu của v2 phụ thuộc module AI, **bỏ qua** ở đợt này.
- [ ] Đề xuất commit: `feat(admin): vi i18n, dashboard summary and low-stock widgets`

## Task BE-12: Dọn dẹp

- [ ] Xóa `src/scripts/seed-demo-products.ts` (áo quần) và phần seed áo quần còn sót.
- [ ] Cập nhật `.env.template` (`DEMO_PASSWORD`, các biến search nếu BE-3 thêm).
- [ ] Cập nhật `README.md`: lệnh seed mới (`medusa exec ./src/scripts/seed-grocery.ts`).
- [ ] Rà lại bảng API ở mục 3 so với route thật; đồng bộ sang file FE.
- [ ] Đề xuất commit: `chore: remove apparel demo seed, update env template and README`

## 5. Cách chia đôi công việc khi sync dở

- **Đợt 1 (mở đường cho FE):** BE-1, BE-2, BE-3. Xong ba task này FE làm được catalog, trang chủ, danh sách, chi tiết, giỏ.
- **Đợt 2 (luồng mua):** BE-4, BE-5, rồi BE-6, BE-7, BE-8. FE làm thanh toán, thành công, đơn hàng, theo dõi đơn.
- **Đợt 3 (có thể sau):** BE-9, BE-10, BE-11, BE-12.
- Khi dừng giữa chừng: ghi hash commit cuối vào bảng mục 0 và liệt kê ở đây điều chưa làm dở.

**Nhật ký bàn giao** (thêm dòng mới ở trên cùng):

| Ngày | Người | Đã xong | Dở dang / lưu ý |
| :--- | :--- | :--- | :--- |
| 2026-10-18 | | Chưa bắt đầu, mới có kế hoạch | |
