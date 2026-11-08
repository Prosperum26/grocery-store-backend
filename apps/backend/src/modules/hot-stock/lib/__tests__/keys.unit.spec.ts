import { hotStockKeys } from "../keys"

describe("hotStockKeys", () => {
  const keys = hotStockKeys("c4f:")
  const ref = { location_id: "sloc_1", inventory_item_id: "iitem_1" }

  it("dựng key theo tiền tố", () => {
    expect(keys.avail(ref)).toBe("c4f:stock:avail:sloc_1:iitem_1")
    expect(keys.held(ref)).toBe("c4f:stock:held:sloc_1:iitem_1")
    expect(keys.hold("cart_1")).toBe("c4f:hold:cart_1")
    expect(keys.expiry()).toBe("c4f:hold:expiry")
  })

  it("suy key held từ key avail; key lạ thì ném lỗi", () => {
    expect(keys.heldFromAvail(keys.avail(ref))).toBe(keys.held(ref))
    expect(() => keys.heldFromAvail("c4f-test:stock:avail:sloc_1:iitem_1")).toThrow()
  })
})
