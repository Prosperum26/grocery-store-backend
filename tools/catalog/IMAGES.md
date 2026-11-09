# Ảnh sản phẩm (BE-2b)

Ảnh sản phẩm lấy từ link trong `catalog_v2_updated.xlsx`. Ảnh **không nằm trong git**: mỗi người tự tải về máy, rồi gắn vào Medusa bằng một lệnh seed.

## Chạy

Từ thư mục gốc repo backend (Python 3.11+):

```bash
pip install -r tools/catalog/requirements.txt
python tools/catalog/fetch_images.py --limit 20   # chạy thử 20 ảnh
python tools/catalog/fetch_images.py              # tải đủ (chạy lại chỉ tải phần còn thiếu)
npm run seed:images --workspace=@dtc/backend      # upload qua File Module và gắn thumbnail/images
```

Cần backend cấu hình xong (PostgreSQL, Redis, `.env`) và catalog đã được seed (`npm run seed`). `npm run seed` cũng tự gắn ảnh nếu thư mục ảnh đã có file.

- Ảnh lưu ở `apps/backend/src/lib/seed/seed-data/images/<catalog_id>.webp` (WebP, cạnh dài tối đa 800 px).
- `fetch_images.py` in cuối lượt số ảnh đã có, đã tải và lỗi (kèm mã `catalog_id` lỗi). Chạy lại để thử các ảnh lỗi.
- Sản phẩm không có ảnh (khoảng 383 dòng không có link) vẫn hiện bình thường với ảnh giữ chỗ.
- URL ảnh lưu trong DB có dạng `http://localhost:9000/static/...`. Đổi host hoặc cổng backend thì phải gắn lại ảnh.

## Cập nhật danh sách ảnh

`image-manifest.json` sinh từ xlsx, chỉ người bảo trì cần chạy lại khi xlsx đổi:

```bash
python tools/catalog/build_image_manifest.py <đường dẫn catalog_v2_updated.xlsx>
```

## Nguồn và bản quyền

Ảnh thuộc Bách Hoá Xanh (CDN `cdnv2.tgdd.vn`, `cdn.tgdd.vn`), không có giấy phép mở. Chỉ dùng cho đồ án môn học MSIS4133. Không commit ảnh và không đưa ảnh lên repo công khai. `image-manifest.json` giữ `product_url` của từng sản phẩm làm nguồn trích dẫn.
