# Ảnh sản phẩm thật (BE-2b, bước 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sản phẩm catalog v2 có ảnh thật (từ link trong xlsx) qua File Module của Medusa, để storefront chạy dữ liệu thật thấy ảnh.

**Architecture:** Hai script Python nhỏ (sinh danh sách ảnh từ xlsx một lần; mỗi thành viên tải và nén ảnh về thư mục gitignore) và một hàm TypeScript `attachCatalogImages` upload ảnh qua `uploadFilesWorkflow` rồi gắn `thumbnail`/`images` bằng `updateProductsWorkflow`. Hàm chạy tách khỏi `seedCatalog` (vốn bỏ qua sản phẩm đã có) để dùng được trên DB đã seed.

**Tech Stack:** Python 3.11+ (`requests`, `Pillow`, `openpyxl`, `unittest`), Medusa 2.21.1 core-flows, Jest (`@swc/jest`), `medusaIntegrationTestRunner`.

**Spec:** `docs/superpowers/specs/2026-11-09-product-images-design.md`

## Global Constraints

- Ảnh lưu `apps/backend/src/lib/seed/seed-data/images/<catalog_id>.webp`, thư mục gitignore; không commit ảnh.
- WebP, cạnh dài tối đa 800 px, chất lượng 80; tải timeout 20 giây, thử lại tối đa 3 lần, tối đa 4 luồng song song, chỉ nhận `Content-Type: image/*`.
- Khoá nối là `catalog_id` (trong JSON ở `metadata.catalog_id`, cũng là `sku`).
- Giữ File Module mặc định (`http://localhost:9000/static`); không cấu hình `backend_url`, không S3, không alias ảnh, không ảnh món ăn.
- Không sinh lại `catalog-v2.json`.
- Tên biến/hàm/nhánh/commit viết tiếng Anh; ghi chú và tài liệu tiếng Việt. Code demo ngắn, đặt tên rõ, không abstraction thừa.
- Commit nhỏ, mỗi commit một việc, trên nhánh `feature/product-images`. Không đọc/in/commit `.env`.

## Review Focus

Đầu vào hoặc điều kiện có thể làm hỏng, và test ghim chúng (nằm trong task chủ):
- Server trả HTTP 200 nhưng nội dung không phải ảnh (trang lỗi HTML): không ghi file, tính vào ảnh lỗi (Task 2).
- PNG có kênh alpha hoặc bảng màu: vẫn ra WebP hợp lệ (Task 2).
- Tải bị ngắt giữa chừng: không để lại file `.webp` dở dang, lần chạy sau tải lại (Task 2).
- Máy chưa tải ảnh (thư mục `images/` không tồn tại): `attachCatalogImages` không lỗi, mọi sản phẩm vào `missingFile` (Task 3).
- Sản phẩm trong catalog chưa có trong DB (chưa seed): bỏ qua, không lỗi (Task 3).

## File Structure

| File | Trách nhiệm |
| :--- | :--- |
| `tools/catalog/build_image_manifest.py` (mới) | xlsx → `image-manifest.json` (chạy một lần bởi người bảo trì) |
| `tools/catalog/image-manifest.json` (mới) | danh sách `catalog_id, image_url, product_url` |
| `tools/catalog/fetch_images.py` (mới) | manifest → ảnh WebP trong thư mục gitignore |
| `tools/catalog/test_build_image_manifest.py`, `test_fetch_images.py` (mới) | `unittest`, không cần mạng |
| `tools/catalog/requirements.txt`, `IMAGES.md` (mới) | phụ thuộc Python; cách chạy, nguồn và bản quyền |
| `apps/backend/src/lib/seed/upload-images.ts` (mới) | `attachCatalogImages` |
| `apps/backend/src/scripts/seed-images.ts` (mới) | `medusa exec` chỉ gắn ảnh (`npm run seed:images`) |
| `apps/backend/src/scripts/seed.ts`, `apps/backend/package.json` (sửa) | nối gắn ảnh vào seed; thêm script |
| `apps/backend/integration-tests/http/seed-images.spec.ts` (mới) | test tích hợp của `attachCatalogImages` |
| `.gitignore` (sửa) | bỏ qua thư mục ảnh |
| `docs/plans/2026-10-18-sync-ui-v2-backend.md` (sửa) | cập nhật trạng thái BE-2b |

---

### Task 1: Danh sách ảnh từ xlsx

**Files:**
- Create: `tools/catalog/build_image_manifest.py`, `tools/catalog/test_build_image_manifest.py`, `tools/catalog/requirements.txt`, `tools/catalog/image-manifest.json`

**Interfaces:**
- Produces: `rows_to_manifest(rows: list[dict]) -> list[dict]` (mỗi dòng đầu vào có khoá `catalog_id`, `image_url`, `product_url`; trả các dòng có `image_url` bắt đầu bằng `http`, giữ thứ tự, ba khoá `catalog_id`, `image_url`, `product_url` với `product_url` là `None` nếu trống); CLI `python tools/catalog/build_image_manifest.py <xlsx>` ghi `tools/catalog/image-manifest.json` (UTF-8, `indent=1`, `ensure_ascii=False`).

- [ ] **Step 1: Viết test fail** — `test_build_image_manifest.py` (`unittest`): `test_keeps_only_rows_with_http_image_url` (dòng `image_url` rỗng/`None`/không bắt đầu `http` bị bỏ), `test_keeps_order_and_empty_product_url_becomes_none`.
- [ ] **Step 2: Chạy** `python -m unittest discover -s tools/catalog -p "test_build_image_manifest.py"` → FAIL (chưa có module).
- [ ] **Step 3: Cài `rows_to_manifest` và `main()`** trong `build_image_manifest.py`; đọc xlsx bằng `openpyxl` (read-only, hàng đầu là tên cột, đọc theo tên cột `catalog_id`, `image_url`, `product_url`). Tạo `requirements.txt` gồm `requests`, `Pillow`, `openpyxl`.
- [ ] **Step 4: Chạy lại test** → PASS.
- [ ] **Step 5: Commit** `feat(catalog): add image manifest builder` (script, test, requirements).
- [ ] **Step 6: Sinh manifest** từ xlsx ở thư mục gốc workspace: `python tools/catalog/build_image_manifest.py ../catalog_v2_updated.xlsx`. Kiểm tra bằng một lệnh Python ngắn: 1.746 dòng, `catalog_id` đều duy nhất và đều có trong `catalog-v2.json`.
- [ ] **Step 7: Commit** `chore(catalog): add image manifest (1746 products)` (chỉ `image-manifest.json`).

---

### Task 2: Tải và nén ảnh

**Files:**
- Create: `tools/catalog/fetch_images.py`, `tools/catalog/test_fetch_images.py`, `tools/catalog/IMAGES.md`
- Modify: `.gitignore` (thêm `apps/backend/src/lib/seed/seed-data/images/`)

**Interfaces:**
- Consumes: `tools/catalog/image-manifest.json` (Task 1).
- Produces:
  - `convert_to_webp(data: bytes, max_side: int = 800, quality: int = 80) -> bytes` (ném `ValueError` nếu không phải ảnh).
  - `pending(manifest: list[dict], out_dir: Path) -> list[dict]` (các dòng chưa có `<catalog_id>.webp`).
  - `fetch_one(session, row: dict, out_dir: Path) -> None` (tải, kiểm `Content-Type`, `convert_to_webp`, ghi vào file tạm `<catalog_id>.webp.part` rồi đổi tên; ném lỗi nếu hỏng).
  - CLI: `python tools/catalog/fetch_images.py [--limit N]`; in tổng số đã tải, đã có, lỗi (kèm `catalog_id` lỗi); mã thoát 0.

- [ ] **Step 1: Viết test fail** (`unittest`, không dùng mạng): `test_convert_shrinks_long_side_to_800` (PNG 1600×1000 → WebP, cạnh dài 800), `test_convert_keeps_small_image_size`, `test_convert_handles_rgba_png`, `test_convert_rejects_non_image` (bytes HTML → `ValueError`), `test_pending_skips_existing_files`, `test_fetch_one_rejects_html_response_and_writes_nothing` (session giả trả 200, `Content-Type: text/html`; không có file `.webp` lẫn `.part` sau khi lỗi), `test_fetch_one_failure_leaves_no_partial_webp` (session giả trả `image/jpeg` nhưng nội dung hỏng).
- [ ] **Step 2: Chạy** `python -m unittest discover -s tools/catalog -p "test_fetch_images.py"` → FAIL.
- [ ] **Step 3: Cài các hàm trên.** Tải có `timeout=20`; thử lại tối đa 3 lần cho lỗi mạng/5xx, chờ ngắn tăng dần giữa các lần; `main` dùng `ThreadPoolExecutor(max_workers=4)`, thu thập lỗi từng ảnh mà không dừng cả lượt, `--limit` cắt danh sách `pending` còn N dòng đầu.
- [ ] **Step 4: Chạy lại test** → PASS.
- [ ] **Step 5: Commit** `feat(catalog): add fetch_images script` (script + test).
- [ ] **Step 6: Viết `IMAGES.md`** (tiếng Việt): cách chạy (`pip install -r tools/catalog/requirements.txt`, `python tools/catalog/fetch_images.py`, rồi `npm run seed:images --workspace=@dtc/backend`), nguồn ảnh (Bách Hoá Xanh), mục đích học tập, không đưa ảnh lên repo công khai, `image-manifest.json` giữ `product_url` làm nguồn. Thêm dòng gitignore.
- [ ] **Step 7: Commit** `docs(catalog): document image fetching and ignore image folder`.

---

### Task 3: `attachCatalogImages`

**Files:**
- Create: `apps/backend/src/lib/seed/upload-images.ts`, `apps/backend/integration-tests/http/seed-images.spec.ts`

**Interfaces:**
- Consumes: `SeedCatalogData` từ `./seed-data/catalog` (sản phẩm có `handle` và `metadata.catalog_id`).
- Produces: `attachCatalogImages(container: MedusaContainer, catalog: SeedCatalogData, imagesDir?: string): Promise<{ attached: number; hadThumbnail: number; missingFile: number }>`. `imagesDir` mặc định `join(__dirname, "seed-data", "images")`. Xuất thêm hằng `DEFAULT_IMAGES_DIR`.

Quy tắc: chỉ xét sản phẩm catalog có `metadata.catalog_id` và có trong DB (theo `handle`); sản phẩm đã có `thumbnail` → `hadThumbnail`; chưa có mà không có file `<catalog_id>.webp` → `missingFile`; còn lại upload (`uploadFilesWorkflow`, `filename: "<catalog_id>.webp"`, `mimeType: "image/webp"`, `access: "public"`, `content` base64), rồi `updateProductsWorkflow` với `{ products: [{ id, thumbnail: url, images: [{ url }] }] }` theo lô 50, tính vào `attached`. Thư mục không tồn tại coi như không có file nào.

- [ ] **Step 1: Viết test fail** `seed-images.spec.ts`, theo mẫu `seed-catalog.spec.ts` (`medusaIntegrationTestRunner`, `bootstrapStore`, `seedCatalog`). Chuẩn bị: lấy `DEMO_CATALOG`, gán `metadata.catalog_id = "CAT-T1" | "CAT-T2" | "CAT-T3"` cho ba sản phẩm đầu, seed catalog đó; thư mục tạm chứa `CAT-T1.webp`, `CAT-T2.webp` (1×1 WebP hợp lệ, base64 `UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA`). Các `it`:
  - `attaches thumbnail and images to products that have a file`: sau gọi lần 1 → `attached = 2`, `missingFile = 1`; qua `query.graph` hai sản phẩm đầu có `thumbnail` kết thúc bằng `.webp` và chứa `/static/`, `images.length ≥ 1`; sản phẩm thứ ba `thumbnail` là `null`.
  - `is idempotent`: gọi lần 2 → `attached = 0`, `hadThumbnail = 2`; số `images` của sản phẩm không đổi.
  - `does nothing when the images folder does not exist`: `imagesDir` trỏ tới đường không tồn tại → `attached = 0`, `missingFile = 3`, không ném lỗi.
  - `ignores catalog products that are not in the database`: catalog có thêm sản phẩm `handle` chưa seed (có `catalog_id` và có file) → không lỗi, không tính vào `attached`.
- [ ] **Step 2: Chạy** `npm run test:integration:http --workspace=@dtc/backend -- seed-images` (từ PowerShell nếu Bash không chạy được) → FAIL (chưa có module).
- [ ] **Step 3: Cài `attachCatalogImages`** theo quy tắc trên. Kiểu đầu vào của `updateProductsWorkflow`: xem `node_modules/@medusajs/core-flows/dist/product/workflows/update-products.d.ts` (dạng `{ products: [...] }`). Chú thích tiếng Việt ở chỗ chống trùng (tên file bị thêm tiền tố timestamp nên phải bỏ qua sản phẩm đã có thumbnail).
- [ ] **Step 4: Chạy lại test** → PASS. Ghi lại nếu `GET <thumbnail>` có thể kiểm trong test này; nếu không, giữ kiểm tra theo `/static/` và để việc kiểm HTTP thật cho Task 5.
- [ ] **Step 5: Chạy `seed-catalog.spec.ts`** để chắc không hỏng test hiện có → PASS.
- [ ] **Step 6: Commit** `feat(seed): attach catalog images via the file module`.

---

### Task 4: Nối vào seed

**Files:**
- Create: `apps/backend/src/scripts/seed-images.ts`
- Modify: `apps/backend/src/scripts/seed.ts`, `apps/backend/package.json`

**Interfaces:**
- Consumes: `attachCatalogImages`, `loadCatalogV2`.
- Produces: `npm run seed:images --workspace=@dtc/backend` (chạy `medusa exec ./src/scripts/seed-images.ts`).

- [ ] **Step 1: Tạo `seed-images.ts`** (export default `ExecArgs`): gọi `attachCatalogImages(container, loadCatalogV2())` và in `Images: attached X, already had Y, missing file Z`. Thêm script `seed:images` vào `package.json`.
- [ ] **Step 2: Sửa `seed.ts`:** sau `seedCatalog` gọi `attachCatalogImages` với cùng catalog đã nạp (đặt vào biến `catalogData`, dùng cho cả hai lệnh) và in cùng dòng kết quả.
- [ ] **Step 3: Kiểm tra biên dịch/lint:** `npm run build --workspace=@dtc/backend` hoặc `npx tsc --noEmit -p apps/backend` → không lỗi mới.
- [ ] **Step 4: Chạy test** `seed-catalog.spec.ts` và `seed-images.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(seed): add seed:images script and run it from seed`.

---

### Task 5: Chạy thử 20 ảnh và xem ở storefront

**Files:** không tạo file mới; chỉ sửa frontend nếu bước thử cho thấy cần (nhánh `feature/product-images` trong `grocery-store-frontend`, tách từ `origin/dev`).

- [ ] **Step 1:** `python tools/catalog/fetch_images.py --limit 20`; kiểm có 20 file `.webp` trong thư mục ảnh và `git status` không thấy chúng.
- [ ] **Step 2:** Báo người dùng lệnh cần chạy trên DB dev của họ (`npm run seed:images --workspace=@dtc/backend`) và chỉ chạy khi DB/backend sẵn sàng; sau đó gọi Store API (`/store/products?limit=5&fields=thumbnail,images`) với publishable key từ `.env` (không in key ra) để thấy `thumbnail` của sản phẩm đã gắn.
- [ ] **Step 3:** Mở `GET <thumbnail>` bằng `curl` → HTTP 200, `Content-Type: image/webp`.
- [ ] **Step 4:** Chạy storefront với `NEXT_PUBLIC_UI_MOCK=false` (backend cổng 9000) và xem trang chủ/danh mục/chi tiết một sản phẩm có ảnh bằng ảnh chụp màn hình. Nếu ảnh không hiện: kiểm hàm chuyển Medusa → view model có truyền `thumbnail` không, và lỗi của `next/image` với `localhost:9000`; sửa đúng chỗ đó ở frontend, mỗi sửa một commit riêng (`fix(images): ...`).
- [ ] **Step 5:** Ghi kết quả (đạt/không, ảnh chụp, sửa nào) vào phần báo cáo cuối.

---

### Task 6: Tải đủ, gắn ảnh, cập nhật plan

**Files:**
- Modify: `docs/plans/2026-10-18-sync-ui-v2-backend.md` (dòng BE-2b/BE-2 và nhật ký)

- [ ] **Step 1:** Chỉ khi Task 5 đạt: `python tools/catalog/fetch_images.py` (toàn bộ); ghi số ảnh tải được và danh sách lỗi.
- [ ] **Step 2:** Chạy lại `fetch_images.py` lần hai → `0` ảnh cần tải (idempotent). Chạy `seed:images` → `attached` bằng số ảnh mới, chạy lại → `attached 0`.
- [ ] **Step 3:** Chạy toàn bộ `unittest` của `tools/catalog` và hai test tích hợp seed → PASS.
- [ ] **Step 4:** Sửa `docs/plans/2026-10-18-sync-ui-v2-backend.md`: BE-2b đã làm (bước 1), nêu còn lại alias ảnh/ảnh món ăn/S3.
- [ ] **Step 5: Commit** `docs(plan): mark BE-2b step 1 done`.

---

## Self-review

- **Spec coverage:** §5.1 → Task 1; §5.2 → Task 2; §5.3 → Task 3–4; §5.4 và §5.6 → Task 5; §5.5 → Task 3; §6 → `IMAGES.md` (Task 2); §3 số liệu → kiểm ở Task 1 Step 6. Mục D4 (tách khỏi `seedCatalog`) → Task 3–4.
- **Nhất quán tên:** `attachCatalogImages`, `DEFAULT_IMAGES_DIR`, `rows_to_manifest`, `convert_to_webp`, `pending`, `fetch_one`, `seed:images` dùng thống nhất.
- **Cố ý để mở:** URL gốc cấu hình theo môi trường, S3, alias ảnh, ảnh món ăn (ngoài phạm vi, theo spec).
