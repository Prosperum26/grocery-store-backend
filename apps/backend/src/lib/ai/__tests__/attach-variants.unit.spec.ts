import type { AiBasketItem, AiSearchResponse } from "../../../types/ai"
import { attachVariants, buildVariantInfo, catalogIdsOf, type VariantRow } from "../attach-variants"

const item = (catalogId: string, alternatives: string[] = [], qty = 1): AiBasketItem => ({
  ingredient: `nguyên liệu ${catalogId}`,
  kind: "core",
  raw_text: catalogId,
  need: null,
  product: { catalog_id: catalogId, name: `SP ${catalogId}`, category: null, pack_size: 300, pack_unit: "g" },
  derived: false,
  default_qty: qty,
  pack_hint: 2,
  alternatives: alternatives.map((id) => ({ catalog_id: id, name: `Thay ${id}` })),
})

const DATA: AiSearchResponse = {
  query: "canh chua",
  servings: 4,
  accepted: true,
  threshold: 0.64,
  results: [
    {
      recipe: { id: "a", name: "Canh chua", family: null, servings: 4, time_minutes: 30, difficulty: null, description: null, image_url: null, source_url: "u" },
      score: 0.7,
      matched_by: "both",
      complete: true,
      basket: { buy: [item("CAT-1", ["CAT-2", "CAT-3"])], maybe_have: [item("CAT-4", ["CAT-2"], 0)] },
    },
    {
      recipe: { id: "b", name: "Canh chua cá hồi", family: null, servings: 4, time_minutes: 30, difficulty: null, description: null, image_url: null, source_url: "u" },
      score: 0.6,
      matched_by: "semantic",
      complete: true,
      basket: { buy: [item("CAT-1")], maybe_have: [] },
    },
  ],
}

const row = (id: string, sku: string, status = "published", amount: number | null = 59000): VariantRow => ({
  id,
  sku,
  title: "Vỉ 300g",
  product: { id: `prod_${id}`, handle: `h-${sku}`, title: `Tên ${sku}`, status },
  calculated_price: amount === null ? null : { calculated_amount: amount },
})

describe("catalogIdsOf", () => {
  it("lấy sản phẩm chính và phương án thay thế của mọi món, không trùng", () => {
    expect(catalogIdsOf(DATA)).toEqual(["CAT-1", "CAT-2", "CAT-3", "CAT-4"])
  })

  it("không có món nào thì không có id", () => {
    expect(catalogIdsOf({ ...DATA, accepted: false, results: [] })).toEqual([])
  })
})

describe("buildVariantInfo", () => {
  it("dựng thông tin bán hàng theo sku: giá đang tính, tồn, còn mua được", () => {
    const info = buildVariantInfo([row("v1", "CAT-1")], () => 12)
    expect(info.get("CAT-1")).toEqual({
      variant_id: "v1",
      product_id: "prod_v1",
      handle: "h-CAT-1",
      thumbnail: null,
      title: "Tên CAT-1",
      unit_label: "Vỉ 300g",
      unit_price: 59000,
      available: 12,
      purchasable: true,
    })
  })

  it("hết hàng, thiếu số tồn, hoặc tồn âm đều là không mua được với available 0", () => {
    const info = buildVariantInfo([row("v1", "CAT-1"), row("v2", "CAT-2"), row("v3", "CAT-3")], (id) => ({ v1: 0, v2: undefined, v3: -4 })[id as "v1"])
    for (const sku of ["CAT-1", "CAT-2", "CAT-3"]) {
      expect(info.get(sku)).toMatchObject({ available: 0, purchasable: false })
    }
  })

  it("không quản kho (null) là không giới hạn, mua được", () => {
    expect(buildVariantInfo([row("v1", "CAT-1")], () => null).get("CAT-1")).toMatchObject({ available: Number.MAX_SAFE_INTEGER, purchasable: true })
  })

  it("sản phẩm draft không có trong kết quả (storefront nhận variant: null)", () => {
    expect(buildVariantInfo([row("v1", "CAT-1", "draft")], () => 5).size).toBe(0)
  })

  it("thiếu giá thì giá 0 chứ không làm hỏng cả câu trả lời", () => {
    expect(buildVariantInfo([row("v1", "CAT-1", "published", null)], () => 5).get("CAT-1")?.unit_price).toBe(0)
  })
})

describe("attachVariants", () => {
  const info = buildVariantInfo([row("v1", "CAT-1"), row("v2", "CAT-2"), row("v4", "CAT-4", "published")], (id) => (id === "v2" ? 0 : 9))
  const out = attachVariants(DATA, info)

  it("gắn variant cho sản phẩm chính ở cả buy và maybe_have", () => {
    expect(out.results[0].basket.buy[0].variant?.variant_id).toBe("v1")
    expect(out.results[0].basket.maybe_have[0].variant?.variant_id).toBe("v4")
    expect(out.results[1].basket.buy[0].variant?.variant_id).toBe("v1")
  })

  it("gắn variant cho từng phương án thay thế, null khi không bán được", () => {
    const alts = out.results[0].basket.buy[0].alternatives
    expect(alts.map((a) => [a.catalog_id, a.variant?.variant_id ?? null])).toEqual([["CAT-2", "v2"], ["CAT-3", null]])
    expect(alts[0].variant).toMatchObject({ available: 0, purchasable: false })
  })

  it("giữ nguyên mọi trường của AI và không sửa dữ liệu gốc", () => {
    expect(out.results[0].basket.buy[0]).toMatchObject({ default_qty: 1, pack_hint: 2, derived: false, ingredient: "nguyên liệu CAT-1" })
    expect(out.results[0].basket.maybe_have[0].default_qty).toBe(0)
    expect(out).toMatchObject({ query: "canh chua", servings: 4, accepted: true, threshold: 0.64 })
    expect("variant" in DATA.results[0].basket.buy[0]).toBe(false)
  })

  it("sản phẩm không có trong Medusa thì variant null và vẫn giữ tên để hiện", () => {
    const none = attachVariants(DATA, new Map())
    expect(none.results[0].basket.buy[0]).toMatchObject({ variant: null, product: { name: "SP CAT-1" } })
  })
})
