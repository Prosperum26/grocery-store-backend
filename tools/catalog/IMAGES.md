# Ảnh sản phẩm (BE-2b)

Ảnh sản phẩm lấy từ link trong `catalog_v2_updated.xlsx`. Danh sách link nằm ở `apps/backend/src/lib/seed/seed-data/image-manifest.json` (1.901 sản phẩm có ảnh, đã commit):

- 1.746 ảnh Bách Hoá Xanh có sẵn trong xlsx (`CAT-000001` đến `CAT-001775`, có `product_url`).
- 155 ảnh bổ sung cho sản phẩm thêm tay (`CAT-001776` trở đi), nhóm tìm và duyệt tay từ Co.op Online, Bách Hoá Xanh và Wikimedia Commons. Nguồn từng ảnh: `ATTRIBUTION-extra-images.md` (ảnh Wikimedia CC BY-SA phải ghi tác giả).

## Hai cách có ảnh

`npm run seed` và `npm run seed:images` gắn ảnh cho từng sản phẩm chưa có `thumbnail` theo thứ tự:

1. **Có file đã tải về** (`seed-data/images/<catalog_id>.webp`): upload qua File Module, ảnh nằm trên backend (`http://localhost:9000/static/...`).
2. **Không có file**: ghi thẳng link gốc (CDN Bách Hoá Xanh, Co.op Online hoặc Wikimedia) vào `thumbnail`.
3. Không có cả hai (228 sản phẩm không có link): giữ nguyên, storefront hiện ảnh giữ chỗ.

| | Tải ảnh về (cách 1) | Dùng link gốc (cách 2) |
| :--- | :--- | :--- |
| Cần làm | chạy `fetch_images.py` trước | không cần gì |
| Khi deploy | ảnh vỡ (URL `localhost`, thư mục `static/` không theo git) | hiện được ở mọi nơi |
| Rủi ro | mất `static/` thì mất ảnh | Bách Hoá Xanh đổi, xoá link hoặc chặn hotlink thì ảnh vỡ |

**Deploy:** không chạy `fetch_images.py` trên máy chủ, chỉ chạy `npm run seed` (hoặc `seed:images`) với DB production. Storefront đã cho phép các host ảnh (`cdnv2.tgdd.vn`, `cdn.tgdd.vn`, `lh3.googleusercontent.com`, `thumb.wikimedia.org`) trong `next.config.js`.

Sản phẩm đã có `thumbnail` thì không bị đổi. Muốn chuyển một DB đang dùng ảnh local sang link gốc thì phải xoá `thumbnail` của các sản phẩm đó trước.

## Chạy

Từ thư mục gốc repo backend:

```bash
npm run seed:images --workspace=@dtc/backend      # gắn ảnh (link gốc nếu chưa tải ảnh)
```

Muốn ảnh nằm trên backend (demo không phụ thuộc CDN), tải ảnh trước (Python 3.11+):

```bash
pip install -r tools/catalog/requirements.txt
python tools/catalog/fetch_images.py --limit 20   # chạy thử 20 ảnh
python tools/catalog/fetch_images.py              # tải đủ, khoảng 51 MB (chạy lại chỉ tải phần còn thiếu)
npm run seed:images --workspace=@dtc/backend
```

- Ảnh lưu ở `apps/backend/src/lib/seed/seed-data/images/<catalog_id>.webp` (WebP, cạnh dài tối đa 800 px, thư mục gitignore).
- `fetch_images.py` in cuối lượt số ảnh đã có, đã tải và lỗi (kèm mã `catalog_id` lỗi). Chạy lại để thử các ảnh lỗi.
- CDN trả 403 cho User-Agent mặc định của `python-requests`, nên script dùng User-Agent riêng của dự án.

## Cập nhật danh sách ảnh

`image-manifest.json` sinh từ xlsx, chỉ người bảo trì cần chạy lại khi xlsx đổi:

```bash
python tools/catalog/build_image_manifest.py <đường dẫn catalog_v2_updated.xlsx>
```

## Nguồn và bản quyền

Ảnh thuộc Bách Hoá Xanh (CDN `cdnv2.tgdd.vn`, `cdn.tgdd.vn`), không có giấy phép mở. Chỉ dùng cho đồ án môn học MSIS4133. Không commit ảnh và không đưa ảnh lên repo công khai. `image-manifest.json` giữ `product_url` của từng sản phẩm làm nguồn trích dẫn.
