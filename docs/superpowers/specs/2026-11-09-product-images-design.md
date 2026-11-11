# Ảnh sản phẩm thật (BE-2b, bước 1)

Ngày: 2026-11-09 · Nhánh: `feature/product-images` (từ `origin/dev`) · Trạng thái: chờ duyệt

## 1. Mục tiêu

Sản phẩm trong catalog v2 hiện chưa có ảnh (BE-2b bị hoãn, storefront hiện ảnh giữ chỗ). Mục tiêu của bước này: chạy storefront ở chế độ dữ liệu thật (`NEXT_PUBLIC_UI_MOCK=false`) và thấy ảnh thật của những sản phẩm đã có link ảnh, lấy qua File Module của Medusa.

Tiêu chí xong:
- Sau khi tải ảnh và chạy seed, mọi sản phẩm có ảnh tải được đều có `thumbnail` và `images` trong Store API.
- Chạy seed lần hai không tạo thêm ảnh.
- Sản phẩm không có ảnh vẫn hiện bình thường (ảnh giữ chỗ).
- Storefront hiển thị được ảnh từ `localhost:9000` ở chế độ dữ liệu thật.

## 2. Phạm vi

**Trong phạm vi:** tải và nén ảnh, upload qua File Module (provider local), gắn `thumbnail`/`images`, kiểm tra hiển thị ở storefront.

**Ngoài phạm vi (làm sau nếu còn thời gian):**
- Dùng lại ảnh của sản phẩm "gốc" cho sản phẩm thiếu ảnh (alias, cần người duyệt cặp).
- Ảnh món ăn / công thức.
- S3 cho production, URL gốc cấu hình theo môi trường.

## 3. Dữ liệu đầu vào (đã đo)

Từ `catalog_v2_updated.xlsx` (nằm ngoài các repo, ở thư mục gốc workspace):
- 2.129 sản phẩm; khoá nối với `catalog-v2.json` là `catalog_id` (trong JSON ở `metadata.catalog_id`, dạng `CAT-000001`).
- 1.746 dòng có `image_url`, đều trên CDN của Bách Hoá Xanh (`cdnv2.tgdd.vn`, `cdn.tgdd.vn`); 1.701 jpg, 45 png.
- 383 dòng không có `image_url`: các sản phẩm này giữ ảnh giữ chỗ.
- Một ảnh mẫu tải được (HTTP 200, 37 KB, không cần referer). Chưa kiểm hết 1.746 link.

## 4. Quyết định

| # | Quyết định | Lý do |
| :--- | :--- | :--- |
| D1 | Mỗi thành viên tự chạy script tải ảnh; ảnh không nằm trong git | Tránh phân phối lại ảnh của bên thứ ba và tránh repo nặng thêm hàng chục MB |
| D2 | Commit một file danh sách nhỏ `tools/catalog/image-manifest.json` thay vì cần file xlsx | Xlsx nằm ngoài repo; các thành viên khác không có file đó |
| D3 | Không sinh lại `catalog-v2.json` từ xlsx | Tránh làm đổi giá/tồn/mô tả ngoài ý muốn |
| D4 | Gắn ảnh là một bước riêng sau `seedCatalog`, không nhét vào bước tạo sản phẩm | `seedCatalog` bỏ qua hẳn sản phẩm đã có theo `handle`, nên DB đã seed sẽ không bao giờ được gắn ảnh nếu chỉ sửa bước tạo |
| D5 | Giữ cấu hình File Module mặc định (`http://localhost:9000/static`) | Mỗi người chạy backend ở cổng 9000; `file-local` có tuỳ chọn `backend_url` để đổi sau, chưa cần |

## 5. Thiết kế

### 5.1 Danh sách ảnh (`tools/catalog/image-manifest.json`)

Mảng các `{ catalog_id, image_url, product_url }` chỉ gồm dòng có `image_url`, sinh một lần bằng `tools/catalog/build_image_manifest.py <đường dẫn xlsx>` rồi commit. Người bảo trì chạy lại script này khi xlsx đổi; các thành viên khác không cần xlsx.

### 5.2 Tải ảnh (`tools/catalog/fetch_images.py`)

- Đầu vào: `image-manifest.json`. Đầu ra: `apps/backend/src/lib/seed/seed-data/images/<catalog_id>.webp` (thư mục được gitignore).
- Mỗi ảnh: tải với timeout 20 giây, thử lại tối đa 3 lần, chỉ nhận phản hồi có `Content-Type: image/*`, giảm cạnh dài xuống tối đa 800 px, lưu WebP chất lượng 80.
- Tải song song giới hạn 4 luồng, để không dồn 1.746 request vào CDN.
- Chạy lại thì bỏ qua file đã có. Ảnh lỗi chỉ được liệt kê cuối lượt, không làm dừng cả lượt.
- Tuỳ chọn `--limit N` để thử với N ảnh đầu tiên.
- Phụ thuộc Python: `requests`, `Pillow` (ghi trong `tools/catalog/requirements.txt`).

### 5.3 Gắn ảnh vào Medusa (`apps/backend/src/lib/seed/upload-images.ts`)

```
attachCatalogImages(container, catalog, imagesDir?) -> { attached, hadThumbnail, missingFile }
```

1. Lập bản đồ `handle → catalog_id` từ `catalog.products[].metadata.catalog_id`.
2. Truy vấn các sản phẩm theo `handle` để biết sản phẩm nào chưa có `thumbnail`.
3. Với mỗi sản phẩm chưa có `thumbnail` mà tồn tại file `<catalog_id>.webp` trong `imagesDir`: gọi `uploadFilesWorkflow` (`access: "public"`, nội dung base64), rồi gắn `thumbnail` và `images: [{ url }]` bằng `updateProductsWorkflow`, cập nhật theo lô.
4. Sản phẩm đã có `thumbnail` bị bỏ qua (chống trùng, vì file-local thêm tiền tố timestamp vào tên file nên gọi lại sẽ tạo bản mới). Sản phẩm không có file thì bỏ qua và được đếm vào `missingFile`.

`imagesDir` mặc định trỏ tới thư mục ở 5.2; test truyền thư mục tạm.

Nối vào `npm run seed` sau `seedCatalog`, chạy được cả trên DB đã seed. Seed không lỗi khi chưa tải ảnh (không có file thì không làm gì).

Giới hạn đã biết: nếu upload xong mà cập nhật sản phẩm lỗi thì còn file mồ côi trong `static/`; chấp nhận được. URL ảnh lưu trong DB có host `localhost:9000`; đổi host thì phải seed lại ảnh.

### 5.4 Storefront

- Chạy với `NEXT_PUBLIC_UI_MOCK=false` (đã đặt trong `.env.local` của người dùng) và backend ở cổng 9000.
- `next.config.js` đã cho phép host `localhost` qua `remotePatterns`.
- Cần kiểm chứng (ở bước thử 20 ảnh) hai chỗ chưa xác nhận: hàm chuyển dữ liệu Medusa sang view model có truyền `thumbnail` không, và `next/image` có tải được ảnh từ `localhost:9000` không. Nếu không, sửa đúng chỗ đó.

### 5.5 Kiểm thử

Test tích hợp thêm vào `integration-tests/http/seed-catalog.spec.ts` dùng thư mục ảnh tạm chứa vài file WebP nhỏ hợp lệ:
1. Sản phẩm có file thì có `thumbnail` khác null và `images.length ≥ 1`; file đã được ghi trong `uploads/` của `apps/backend`.
2. Chạy `attachCatalogImages` lần hai thì `attached = 0` và số `images` của sản phẩm không đổi.
3. Sản phẩm không có file thì giữ nguyên `thumbnail = null`.

Đường `GET <thumbnail>` trả 200 trong server của integration test chưa được xác nhận; nếu không phục vụ được thì kiểm tra file tồn tại trong `uploads/` và URL có tiền tố `/static/`, rồi kiểm tra HTTP thật ở bước thử.

### 5.6 Bước thử (trước khi tải cả 1.746 ảnh)

1. `fetch_images.py --limit 20`.
2. Chạy seed → kiểm tra Store API trả `thumbnail` cho 20 sản phẩm đó.
3. Chạy storefront ở chế độ dữ liệu thật → xem ảnh hiển thị đúng.
4. Nếu cả ba qua, chạy tải toàn bộ.

## 6. Bản quyền

Ảnh thuộc Bách Hoá Xanh, không có giấy phép mở. Chỉ dùng cho đồ án môn học; ảnh không commit và không đưa lên repo công khai. `tools/catalog/IMAGES.md` ghi nguồn và mục đích; `image-manifest.json` giữ `product_url` của từng sản phẩm làm nguồn trích dẫn.

## 7. Rủi ro

- CDN có thể chặn hoặc giới hạn tốc độ khi tải số lượng lớn → tải có giới hạn, chạy lại được.
- Tải 1.746 ảnh và upload tuần tự có thể mất vài phút; chấp nhận được vì là việc chạy một lần.
- Dung lượng ước tính 40–70 MB trên mỗi máy (ngoại suy từ một ảnh mẫu 37 KB).
