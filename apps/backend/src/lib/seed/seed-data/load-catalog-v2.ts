import { readFileSync } from "fs"
import { join } from "path"
import type { SeedCatalogData } from "./catalog"

// Catalog thật (2.129 sản phẩm, 11 danh mục) cho `npm run seed`. File JSON sinh từ
// data/catalog_v2_updated.xlsx bằng tools/catalog/build_catalog_v2.py; sửa dữ liệu thì sửa xlsx rồi chạy lại script.
// Đọc lúc chạy (không import) để tsc không phải suy kiểu cho file JSON 1,4 MB.
export function loadCatalogV2(): SeedCatalogData {
  return JSON.parse(readFileSync(join(__dirname, "catalog-v2.json"), "utf-8"))
}
