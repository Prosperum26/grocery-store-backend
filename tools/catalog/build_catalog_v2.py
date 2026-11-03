"""Chuyển catalog_v2_updated.xlsx thành seed-data/catalog-v2.json cho `npm run seed`.

Chạy (Python 3.11+, cần pandas và openpyxl):
    python tools/catalog/build_catalog_v2.py <đường dẫn catalog_v2_updated.xlsx> [thư mục data chứa recipes_v2.json]

Quy tắc (BE-2, chốt 2026-10-28):
- Nạp đủ mọi dòng, mỗi dòng là một sản phẩm một biến thể, sku = catalog_id. AI tham chiếu sản phẩm
  bằng catalog_id nên không xoá, không gộp dòng nào.
- Sản phẩm ẩn (status "draft", storefront và tìm kiếm không thấy):
  * dòng có note_2 (combo, nhóm đã đánh dấu "Không hiện trên web");
  * bản trùng: cùng tên và cùng quy cách với dòng khác. Giữ hiện bản AI đang tham chiếu, nếu không có
    thì bản có catalog_id nhỏ nhất; các bản còn lại ẩn và ghi metadata.duplicate_of.
- Cùng tên nhưng khác quy cách: cả hai đều hiện, thêm quy cách vào cuối tên để phân biệt.
- Handle là slug không dấu của tên; trùng handle thì thêm hậu tố số của catalog_id.
- 89 danh mục gốc gom về 11 danh mục cha (CATEGORY_MAP). Danh mục gốc giữ ở metadata.subcategory.
- Tồn kho và giá khuyến mãi sinh tất định từ catalog_id (chạy lại ra cùng kết quả). Giá gốc lấy cột
  Price, vốn do data/Price.py ước lượng, không phải giá thị trường.
"""

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[2] / "apps/backend/src/lib/seed/seed-data/catalog-v2.json"
# Ghi chú các sản phẩm bị ẩn, sinh lại mỗi lần chạy để khớp với JSON.
HIDDEN_NOTE = Path(__file__).resolve().parent / "hidden-products.md"

# Danh mục cha: handle, tên, màu đĩa nền (tint) mặc định cho sản phẩm trong danh mục.
PARENTS = [
    ("rau-cu", "Rau củ", "green"),
    ("trai-cay", "Trái cây", "yellow"),
    ("thit", "Thịt", "pink"),
    ("hai-san", "Hải sản", "orange"),
    ("trung-sua", "Trứng & Sữa", "cream"),
    ("gao-do-kho", "Gạo & Đồ khô", "cream"),
    ("gia-vi", "Gia vị", "brown"),
    ("do-uong", "Đồ uống", "blue"),
    ("mi-an-lien", "Mì & Đồ ăn liền", "yellow"),
    ("banh-keo-an-vat", "Bánh kẹo & Ăn vặt", "red"),
    ("dong-lanh-che-bien", "Đông lạnh & Chế biến sẵn", "blue"),
]

CATEGORY_MAP = {
    "rau-cu": ["Củ, quả", "Rau lá", "Nấm các loại"],
    "trai-cay": ["Trái cây"],
    "thit": ["Thịt heo", "Thịt bò", "Thịt gà, vịt"],
    "hai-san": ["Cá, hải sản"],
    "trung-sua": [
        "Trứng gà, vịt, cút", "Sữa tươi", "Sữa bột, pha sẵn", "Sữa chua", "Sữa chua uống liền",
        "Sữa đặc", "Sữa hạt, sữa đậu", "Sữa trái cây",
    ],
    "gao-do-kho": [
        "Gạo, nếp", "Ngũ cốc, yến mạch", "Đậu, nấm, đồ khô", "Bột các loại", "Miến, hủ tiếu, phở khô",
        "Bún các loại", "Nui các loại", "Mì Ý, mì trứng", "Bánh tráng, vỏ bánh", "Đồ chay các loại",
    ],
    "gia-vi": [
        "Gia vị nêm sẵn", "Hạt nêm, bột ngọt, bột canh", "Nước mắm", "Nước chấm, mắm", "Nước tương",
        "Tương ớt-đen, mayonnaise", "Dầu ăn", "Dầu hào, giấm, bơ", "Tiêu, sa tế, ớt bột", "Đường",
        "Muối", "Bột nghệ, tỏi, hồi, quế,...", "Chao", "Cá mắm, dưa mắm", "Nước cốt dừa lon", "Mật ong",
    ],
    "do-uong": [
        "Nước ngọt", "Nước tăng lực, bù khoáng", "Nước trà", "Nước ép trái cây", "Nước suối", "Nước yến",
        "Cà phê hoà tan", "Cà phê pha phin", "Cà phê lon", "Trà khô, túi lọc", "Bia, nước có cồn", "Rượu",
    ],
    "mi-an-lien": ["Mì ăn liền", "Phở, bún ăn liền", "Hủ tiếu, miến", "Cháo gói, cháo tươi"],
    "banh-keo-an-vat": [
        "Bánh Chocopie", "Bánh quy", "Bánh snack", "Bánh tươi, Sandwich", "Bánh xốp", "Bánh quế",
        "Bánh que", "Bánh gạo", "Bánh gạo Hàn Quốc", "Bánh trung thu", "Socola", "Kẹo dẻo, kẹo marshmallow",
        "Kẹo cứng", "Kẹo Singum", "Rong biển", "Hạt khô", "Trái cây sấy", "Khô chế biến sẵn",
        "Cơm cháy, bánh tráng", "Bánh phồng, bánh đa", "Rau câu, thạch dừa",
    ],
    "dong-lanh-che-bien": [
        "Hàng đông chế biến", "Hàng mát chế biến", "Viên đông, viên mát", "Chả giò",
        "Xúc xích, lạp xưởng, giò chả", "Xúc xích", "Thủy hải sản, thịt đông", "Kem",
        "Heo, bò, pate hộp", "Cá hộp",
    ],
}
SUB_TO_PARENT = {sub: parent for parent, subs in CATEGORY_MAP.items() for sub in subs}
TINT = {handle: tint for handle, _, tint in PARENTS}

# Từ đầu của cột unit dùng làm đơn vị đếm tồn ("Còn 3 khay").
STOCK_UNITS = {
    "chai", "gói", "hộp", "khay", "lon", "bịch", "hũ", "lọ", "túi", "vỉ", "thùng", "lốc", "can", "ly",
    "bó", "trái", "con", "phần", "vỉ", "cây", "bao", "hũ", "kg",
}
LOW_STOCK = 10

# "Thùng 12 chai ...", "24 gói ...": hàng nhiều đơn vị, cột unit chỉ ghi quy cách của một đơn vị.
MULTI_PACK = re.compile(r"^(?:thùng\s+)?(\d+)\s+(gói|chai|lon|hộp|ly|túi|can|bịch|hũ|cái)\b", re.IGNORECASE)


def slugify(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def seeded_int(catalog_id: str, salt: str) -> int:
    # Số nguyên tất định theo catalog_id, không phụ thuộc thứ tự dòng hay lần chạy.
    return int(hashlib.md5(f"{salt}:{catalog_id}".encode()).hexdigest()[:8], 16)


def clean(value) -> str:
    return "" if pd.isna(value) else str(value).strip()


def weight_grams(size, unit: str, qty: int):
    # ml coi như gam (đủ cho hiển thị "đ/kg"); đơn vị đếm (hộp, trái...) không có cân nặng.
    if pd.isna(size) or float(size) <= 0:
        return None
    factor = {"g": 1, "kg": 1000, "ml": 1, "lít": 1000}.get(unit)
    return round(float(size) * factor * qty) if factor else None


def stock_for(catalog_id: str) -> int:
    # ~3% hết hàng, ~10% sắp cạn (1..LOW_STOCK-1), còn lại 15..120.
    roll = seeded_int(catalog_id, "stock") % 100
    if roll < 3:
        return 0
    if roll < 13:
        return 1 + seeded_int(catalog_id, "low") % (LOW_STOCK - 1)
    return 15 + seeded_int(catalog_id, "qty") % 106


def sale_price_for(catalog_id: str, price: int):
    # ~1/70 sản phẩm hiện (khoảng 30 món) giảm 10, 15 hoặc 20%, làm tròn tới 100đ.
    if seeded_int(catalog_id, "sale") % 70 != 0:
        return None
    pct = (10, 15, 20)[seeded_int(catalog_id, "pct") % 3]
    sale = int(round(price * (100 - pct) / 100 / 100) * 100)
    return sale if 0 < sale < price else None


def ai_referenced_ids(data_dir: Path) -> set:
    ids = set()
    for name in ("ingredient_to_catalog_v2.json", "recipes_v2.json"):
        path = data_dir / name
        if path.exists():
            ids |= set(re.findall(r"CAT-\d{6}", path.read_text(encoding="utf-8")))
    return ids


def write_hidden_note(products: list, ai_ids: set):
    hidden = [p for p in products if p["status"] == "draft"]
    lines = [
        "# Sản phẩm ẩn trong catalog v2",
        "",
        "File này do `build_catalog_v2.py` sinh ra, đừng sửa tay. Muốn đổi thì sửa `note_2` trong",
        "`catalog_v2_updated.xlsx` rồi chạy lại script.",
        "",
        "Sản phẩm ẩn vẫn được seed vào Medusa với `status = draft` và `sku = catalog_id`, để AI tra được",
        "theo `catalog_id`. Store API và `/store/search` chỉ trả sản phẩm `published` nên khách không thấy",
        "và không thêm được vào giỏ.",
        "",
        "- **combo**: nhóm đánh dấu `note_2` là \"Không hiện trên web, vẫn giữ database\".",
        "- **duplicate**: cùng tên và cùng quy cách với sản phẩm khác. Bản hiện là bản AI đang tham chiếu,",
        "  nếu không có thì bản có `catalog_id` nhỏ nhất.",
        "",
        f"Tổng: {len(hidden)} sản phẩm ẩn.",
        "",
        "| catalog_id | Tên | Lý do | Bản đang hiện | AI đang tham chiếu |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ]
    for p in hidden:
        m = p["metadata"]
        cid = m["catalog_id"]
        lines.append(
            f"| {cid} | {p['title']} | {m['hidden_reason']} | {m.get('duplicate_of', '')} "
            f"| {'**Có**: cần đổi trong dữ liệu AI' if cid in ai_ids else ''} |"
        )
    HIDDEN_NOTE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(xlsx: Path, data_dir: Path):
    df = pd.read_excel(xlsx)
    report = {"hidden_combo": [], "hidden_duplicate": [], "renamed": [], "handle_suffix": [],
              "multi_pack": [], "price_suspect": [], "missing_unit": [], "hidden_but_ai_referenced": []}

    unknown = sorted(set(df["category"]) - set(SUB_TO_PARENT))
    if unknown:
        sys.exit(f"Danh mục chưa ánh xạ: {unknown}")

    ai_ids = ai_referenced_ids(data_dir)
    df["name"] = df["name"].map(clean)
    df["unit"] = df["unit"].map(clean)
    df["pack_unit"] = df["pack_unit"].map(clean)

    # 1. Bản trùng (cùng tên, cùng quy cách): giữ một bản hiện.
    duplicate_of = {}
    for _, group in df.groupby(["name", "unit"]):
        if len(group) < 2:
            continue
        ids = sorted(group["catalog_id"])
        keep = next((i for i in ids if i in ai_ids), ids[0])
        for other in ids:
            if other != keep:
                duplicate_of[other] = keep

    # 2. Cùng tên, khác quy cách: thêm quy cách vào tên.
    name_counts = df[~df["catalog_id"].isin(duplicate_of)]["name"].value_counts()

    products, used_handles = [], set()
    for row in df.sort_values("catalog_id").itertuples(index=False):
        cid, unit = row.catalog_id, row.unit
        title = row.name
        if name_counts.get(title, 0) > 1 and unit and unit.lower() not in title.lower():
            title = f"{title} {unit}"
            report["renamed"].append(f"{cid}: {row.name} -> {title}")

        handle = slugify(title)
        if handle in used_handles:
            handle = f"{handle}-{cid.split('-')[1]}"
            report["handle_suffix"].append(f"{cid}: {handle}")
        used_handles.add(handle)

        # Bản trùng xét trước: nhóm cũng ghi note_2 cho bản trùng, nhưng lý do ẩn khác combo.
        hidden_reason = None
        if cid in duplicate_of:
            hidden_reason = "duplicate"
            report["hidden_duplicate"].append(f"{cid}: {title} (hiện bản {duplicate_of[cid]})")
        elif clean(row.note_2):
            hidden_reason = "combo"
            report["hidden_combo"].append(f"{cid}: {title}")
        if hidden_reason and cid in ai_ids:
            report["hidden_but_ai_referenced"].append(f"{cid}: {title}")

        multi = MULTI_PACK.match(title)
        qty = int(multi.group(1)) if multi else 1
        variant_title = unit or "1 phần"
        # Cột unit đã ghi số lượng ("2 gói") thì giữ nguyên, không nhân đôi.
        if multi and unit and not unit.lower().startswith(multi.group(1)):
            variant_title = f"{multi.group(0)} × {unit}"
            report["multi_pack"].append(f"{cid}: {variant_title} ({int(row.Price):,}đ)")
        # Giá chia cho số đơn vị dưới 2.000đ: gần như chắc giá của một đơn vị, nhóm cần sửa tay.
        if qty > 1 and int(row.Price) / qty < 2000:
            report["price_suspect"].append(f"{cid}: {title} = {int(row.Price):,}đ cho {qty} đơn vị")
        if not unit:
            report["missing_unit"].append(f"{cid}: {title}")

        first_word = unit.split(" ")[0].lower() if unit else ""
        parent = SUB_TO_PARENT[row.category]
        price = int(row.Price)
        sale = None if hidden_reason else sale_price_for(cid, price)

        variant = {"title": variant_title, "sku": cid, "priceVnd": price, "stock": stock_for(cid), "isDefault": True}
        grams = weight_grams(row.pack_size, row.pack_unit.lower(), qty)
        if grams:
            variant["weightGrams"] = grams
        if sale:
            variant["salePriceVnd"] = sale

        metadata = {
            "catalog_id": cid,
            "subcategory": row.category,
            "tint": TINT[parent],
            "stock_unit": first_word if first_word in STOCK_UNITS else "phần",
            "low_stock": LOW_STOCK,
            "source": row.source,
            "needs_review": bool(row.needs_review),
        }
        if hidden_reason:
            metadata["hidden_reason"] = hidden_reason
        if cid in duplicate_of:
            metadata["duplicate_of"] = duplicate_of[cid]

        products.append({
            "handle": handle,
            "title": title,
            "categoryHandle": parent,
            "description": f"{title}, giao từ Kho Q.7.",
            "status": "draft" if hidden_reason else "published",
            "metadata": metadata,
            "variants": [variant],
        })

    out = {
        "categories": [{"handle": h, "name": n} for h, n, _ in PARENTS],
        "products": products,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    write_hidden_note(products, ai_ids)

    published = sum(p["status"] == "published" for p in products)
    print(f"Đã ghi {OUT} : {len(products)} sản phẩm, {published} hiện, {len(products) - published} ẩn")
    per_cat = pd.Series([p["categoryHandle"] for p in products if p["status"] == "published"]).value_counts()
    print("Sản phẩm hiện theo danh mục:", per_cat.to_dict())
    print("Hết hàng:", sum(p["variants"][0]["stock"] == 0 for p in products),
          "| sắp cạn:", sum(0 < p["variants"][0]["stock"] < LOW_STOCK for p in products),
          "| giảm giá:", sum("salePriceVnd" in p["variants"][0] for p in products))
    for key, lines in report.items():
        print(f"\n## {key} ({len(lines)})")
        for line in lines:
            print("  " + line)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    xlsx_path = Path(sys.argv[1])
    main(xlsx_path, Path(sys.argv[2]) if len(sys.argv) > 2 else xlsx_path.parent)
