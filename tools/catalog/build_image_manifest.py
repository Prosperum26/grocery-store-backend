"""Sinh apps/backend/src/lib/seed/seed-data/image-manifest.json từ catalog_v2_updated.xlsx.

Chạy một lần (người bảo trì), rồi commit file kết quả để các thành viên khác không cần file xlsx:
    python tools/catalog/build_image_manifest.py <đường dẫn catalog_v2_updated.xlsx>

File kết quả là danh sách {catalog_id, image_url, product_url} của các sản phẩm có link ảnh.
Ảnh tải về bằng tools/catalog/fetch_images.py (xem IMAGES.md).
"""

import json
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parents[2] / "apps/backend/src/lib/seed/seed-data/image-manifest.json"


def rows_to_manifest(rows: list[dict]) -> list[dict]:
    """Giữ các dòng có image_url bắt đầu bằng http, theo đúng thứ tự trong xlsx."""
    manifest = []
    for row in rows:
        image_url = row.get("image_url")
        if not image_url or not str(image_url).startswith("http"):
            continue
        manifest.append(
            {
                "catalog_id": row["catalog_id"],
                "image_url": str(image_url),
                "product_url": row.get("product_url") or None,
            }
        )
    return manifest


def read_rows(xlsx_path: Path) -> list[dict]:
    """Đọc xlsx theo tên cột ở hàng đầu."""
    sheet = openpyxl.load_workbook(xlsx_path, read_only=True).active
    lines = sheet.iter_rows(values_only=True)
    header = next(lines)
    return [dict(zip(header, line)) for line in lines]


def main() -> None:
    # Console Windows mặc định cp1252 không in được tiếng Việt.
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        sys.exit("Dùng: python tools/catalog/build_image_manifest.py <catalog_v2_updated.xlsx>")
    manifest = rows_to_manifest(read_rows(Path(sys.argv[1])))
    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Đã ghi {len(manifest)} dòng vào {OUT}")


if __name__ == "__main__":
    main()
