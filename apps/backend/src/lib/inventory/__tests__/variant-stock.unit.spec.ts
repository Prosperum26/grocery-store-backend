import { variantStock } from "../variant-stock"

const avail = (values: Record<string, number | null>) => (itemId: string) => values[itemId] ?? null

describe("variantStock", () => {
  it("một item × 1: đúng số trong Redis", () => {
    expect(variantStock({ id: "v1", inventory_items: [{ inventory_item_id: "i1", required_quantity: 1 }] }, "loc", avail({ i1: 7 }))).toEqual({
      variant_id: "v1",
      inventory_item_id: "i1",
      location_id: "loc",
      available: 7,
      held_by_cart: 0,
    })
  })

  it("lốc 6 lon: chia required_quantity và làm tròn xuống; combo lấy item ít nhất", () => {
    expect(variantStock({ id: "loc6", inventory_items: [{ inventory_item_id: "lon", required_quantity: 6 }] }, "loc", avail({ lon: 17 })).available).toBe(2)
    expect(
      variantStock({ id: "combo", inventory_items: [{ inventory_item_id: "lon", required_quantity: 2 }, { inventory_item_id: "ly", required_quantity: 1 }] }, "loc", avail({ lon: 10, ly: 3 })).available
    ).toBe(3)
  })

  it("không âm; chưa có key coi là 0; không quản kho thì null", () => {
    expect(variantStock({ id: "v1", inventory_items: [{ inventory_item_id: "i1" }] }, "loc", avail({ i1: -2 })).available).toBe(0)
    expect(variantStock({ id: "v1", inventory_items: [{ inventory_item_id: "i1" }] }, "loc", avail({})).available).toBe(0)
    expect(variantStock({ id: "v2", manage_inventory: false, inventory_items: [{ inventory_item_id: "i2" }] }, "loc", avail({ i2: 5 }))).toEqual({
      variant_id: "v2",
      inventory_item_id: null,
      location_id: null,
      available: null,
      held_by_cart: 0,
    })
  })

  it("cộng lại phần giỏ người gọi đang giữ; held_by_cart theo đơn vị biến thể", () => {
    const held = (values: Record<string, number>) => (itemId: string) => values[itemId] ?? 0
    expect(variantStock({ id: "v1", inventory_items: [{ inventory_item_id: "i1" }] }, "loc", avail({ i1: 3 }), held({ i1: 2 }))).toMatchObject({ available: 5, held_by_cart: 2 })
    expect(variantStock({ id: "loc6", inventory_items: [{ inventory_item_id: "lon", required_quantity: 6 }] }, "loc", avail({ lon: 4 }), held({ lon: 12 }))).toMatchObject({ available: 2, held_by_cart: 2 })
  })
})
