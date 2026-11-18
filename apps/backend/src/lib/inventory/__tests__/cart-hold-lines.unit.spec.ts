import { cartHoldLines } from "../cart-hold-lines"

const variant = (items: [string, number?][], manage_inventory: boolean | null = true) => ({
  manage_inventory,
  inventory_items: items.map(([inventory_item_id, required_quantity]) => ({ inventory_item_id, required_quantity })),
})

describe("cartHoldLines", () => {
  it("một dòng một item", () => {
    expect(cartHoldLines([{ variant_id: "v1", quantity: 2, variant: variant([["i1", 1]]) }])).toEqual([
      { inventory_item_id: "i1", quantity: 2, variant_ids: ["v1"] },
    ])
  })

  it("gộp hai dòng cùng biến thể (khác cách sơ chế) thành một món", () => {
    expect(
      cartHoldLines([
        { variant_id: "v1", quantity: 2, variant: variant([["i1"]]) },
        { variant_id: "v1", quantity: "3", variant: variant([["i1"]]) },
      ])
    ).toEqual([{ inventory_item_id: "i1", quantity: 5, variant_ids: ["v1"] }])
  })

  it("nhân required_quantity và gộp item dùng chung giữa hai biến thể", () => {
    expect(
      cartHoldLines([
        { variant_id: "loc6", quantity: 2, variant: variant([["lon", 6]]) },
        { variant_id: "lon1", quantity: 1, variant: variant([["lon", 1]]) },
        { variant_id: "combo", quantity: 1, variant: variant([["lon", 2], ["ly", 1]]) },
      ])
    ).toEqual([
      { inventory_item_id: "lon", quantity: 15, variant_ids: ["loc6", "lon1", "combo"] },
      { inventory_item_id: "ly", quantity: 1, variant_ids: ["combo"] },
    ])
  })

  it("bỏ biến thể không quản kho, dòng không có biến thể và số lượng 0", () => {
    expect(
      cartHoldLines([
        { variant_id: "v1", quantity: 1, variant: variant([["i1"]], false) },
        { variant_id: null, quantity: 1, variant: null },
        { variant_id: "v2", quantity: 0, variant: variant([["i2"]]) },
      ])
    ).toEqual([])
  })
})
