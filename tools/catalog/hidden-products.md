# Sản phẩm ẩn trong catalog v2

File này do `build_catalog_v2.py` sinh ra, đừng sửa tay. Muốn đổi thì sửa `note_2` trong
`catalog_v2_updated.xlsx` rồi chạy lại script.

Sản phẩm ẩn vẫn được seed vào Medusa với `status = draft` và `sku = catalog_id`, để AI tra được
theo `catalog_id`. Store API và `/store/search` chỉ trả sản phẩm `published` nên khách không thấy
và không thêm được vào giỏ.

- **combo**: nhóm đánh dấu `note_2` là "Không hiện trên web, vẫn giữ database".
- **duplicate**: cùng tên và cùng quy cách với sản phẩm khác. Bản hiện là bản AI đang tham chiếu,
  nếu không có thì bản có `catalog_id` nhỏ nhất.

Tổng: 3 sản phẩm ẩn.

| catalog_id | Tên | Lý do | Bản đang hiện | AI đang tham chiếu |
| :--- | :--- | :--- | :--- | :--- |
| CAT-000720 | Nui trứng chữ C cao cấp Erici gói 400g | duplicate | CAT-000696 |  |
| CAT-000929 | Combo tiết kiệm | combo |  |  |
| CAT-001008 | Nấm hương hộp 150g | duplicate | CAT-000999 |  |
