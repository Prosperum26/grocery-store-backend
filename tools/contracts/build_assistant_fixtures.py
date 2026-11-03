"""Sinh ví dụ JSON cho hợp đồng Trợ lý Bếp (docs/contracts/assistant-recipes.md, BE-10).

Chạy (Python 3.11+):
    python tools/contracts/build_assistant_fixtures.py <thư mục data chứa recipes_v2.json>

Ví dụ dựng từ dữ liệu thật: công thức và giỏ nguyên liệu (catalog_ids, packs) của nhóm AI trong
recipes_v2.json, giá và tồn từ seed-data/catalog-v2.json. variant_id là giá trị giữ chỗ
"variant_<catalog_id>" vì id thật khác nhau giữa các DB; catalog_id mới là mã ổn định.
Đây là minh hoạ hình dạng dữ liệu, không phải cài đặt: AI service mới là nơi tính thật.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "apps/backend/src/lib/seed/seed-data/catalog-v2.json"
OUT_DIR = ROOT / "docs/contracts/fixtures"

RECIPE_SLUG = "canh-chua-ca-loc"
# Thực đơn 3 bữa theo màn 11 của thiết kế, dùng các món có trong recipes_v2.json.
MEALS = [
    ("T4", "nam-dui-ga-kho-gung"),
    ("T5", "canh-chua-ca-loc"),
    ("T6", "cai-thia-xao-nam-dong-co-thit-cua"),
]
KIND_RANK = {"core": 0, "side": 1, "addon": 2}


def load_products():
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return {p["metadata"]["catalog_id"]: p for p in data["products"]}


def option(products, catalog_id):
    p = products[catalog_id]
    v = p["variants"][0]
    return {
        "catalog_id": catalog_id,
        "variant_id": f"variant_{catalog_id}",
        "title": p["title"],
        "unit_label": v["title"],
        "unit_price": v.get("salePriceVnd", v["priceVnd"]),
        "in_stock": v["stock"] > 0,
    }


def basket_lines(recipe, products):
    """Giỏ của một món: chọn sẵn phương án đầu tiên còn hàng, gộp các nguyên liệu trùng sản phẩm."""
    raw_text = {}
    for ing in recipe["ingredients"]:
        raw_text.setdefault(ing["ingredient"], ing["raw_text"].strip())

    lines = {}
    for b in recipe["basket"]:
        visible = [c for c in b["catalog_ids"] if products[c]["status"] == "published"]
        if not visible:
            continue
        options = [option(products, c) for c in visible]
        chosen = next((o for o in options if o["in_stock"]), options[0])
        need = raw_text.get(b["ingredient"], b["ingredient"])
        line = lines.get(chosen["variant_id"])
        if line:
            # Hai nguyên liệu cùng một sản phẩm: một dòng, nối need_text, giữ kind quan trọng hơn.
            if need not in line["need_text"].split("; "):
                line["need_text"] += f"; {need}"
            line["quantity"] = max(line["quantity"], b["packs"])
            if KIND_RANK[b["kind"]] < KIND_RANK[line["kind"]]:
                line["kind"] = b["kind"]
            continue
        line = {"need_text": need, "kind": b["kind"], **chosen, "quantity": b["packs"]}
        alternatives = [o for o in options if o["variant_id"] != chosen["variant_id"]]
        if alternatives:
            line["alternatives"] = alternatives
        # Thứ tự khoá cố định cho dễ đọc.
        lines[chosen["variant_id"]] = {k: line[k] for k in (
            "need_text", "kind", "catalog_id", "variant_id", "title", "unit_label",
            "quantity", "unit_price", "in_stock", *(["alternatives"] if alternatives else []))}
    return sorted(lines.values(), key=lambda l: KIND_RANK[l["kind"]])


def buy_total(items):
    return sum(i["unit_price"] * i["quantity"] for i in items if i["kind"] != "addon" and i["in_stock"])


def main(data_dir: Path):
    recipes = {r["id"]: r for r in json.loads((data_dir / "recipes_v2.json").read_text(encoding="utf-8"))}
    products = load_products()

    r = recipes[RECIPE_SLUG]
    items = basket_lines(r, products)
    recipe = {
        "slug": r["id"],
        "name": r["name"],
        "serves": r["servings"],
        "time_minutes": r["time_minutes"],
        "steps": r["prep_steps"] + r["cooking_steps"],
        "ingredients": items,
        "buy_total": buy_total(items),
    }

    merged, meals = {}, []
    for day, slug in MEALS:
        m = recipes[slug]
        lines = basket_lines(m, products)
        for line in lines:
            if line["variant_id"] in merged:
                # Ví dụ giữ 1 gói khi hai món dùng chung (lượng gốc không đủ để cộng gram);
                # AI service cộng lượng cần của các món rồi mới làm tròn theo gói.
                merged[line["variant_id"]]["quantity"] = max(merged[line["variant_id"]]["quantity"], line["quantity"])
            else:
                merged[line["variant_id"]] = dict(line)
        meals.append({"day": day, "dish": m["name"], "recipe_slug": slug,
                      "need_variant_ids": [l["variant_id"] for l in lines]})
    basket = sorted(merged.values(), key=lambda l: KIND_RANK[l["kind"]])
    plan = {"meals": meals, "basket": {"items": basket, "total": buy_total(basket)}}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    examples = {
        "recipe-search-response.json": {"recipes": [recipe]},
        "assistant-reply-recipe.json": {"text": f"Đây là công thức {r['name']} cho {r['servings']} người.", "recipe": recipe},
        "assistant-reply-plan.json": {
            "text": "Mình gợi ý thực đơn 3 bữa tối cho 4 người. Nguyên liệu dùng chung chỉ mua một lần.",
            "plan": plan,
        },
    }
    for name, body in examples.items():
        (OUT_DIR / name).write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    shared = len([i for i in basket if sum(i["variant_id"] in m["need_variant_ids"] for m in meals) > 1])
    print(f"recipe {recipe['slug']}: {len(items)} dòng, buy_total {recipe['buy_total']:,}đ")
    print(f"plan: {len(meals)} bữa, {len(basket)} dòng ({shared} dòng dùng chung), total {plan['basket']['total']:,}đ")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
