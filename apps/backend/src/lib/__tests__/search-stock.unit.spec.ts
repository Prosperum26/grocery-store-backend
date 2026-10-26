import { inStock } from "../../search/helpers/stock"

describe("inStock", () => {
  it("sản phẩm không có biến thể thì không còn hàng", () => {
    expect(inStock([])).toBe(false)
  })

  it("biến thể không quản kho luôn còn hàng", () => {
    expect(inStock([{ manage_inventory: false }])).toBe(true)
  })

  it("biến thể quản kho mà tồn khả dụng 0 thì hết hàng", () => {
    expect(inStock([{ manage_inventory: true, available: 0 }])).toBe(false)
  })

  it("chỉ cần một biến thể còn tồn là còn hàng", () => {
    expect(
      inStock([
        { manage_inventory: true, available: 0 },
        { manage_inventory: true, available: 3 },
      ])
    ).toBe(true)
  })
})
