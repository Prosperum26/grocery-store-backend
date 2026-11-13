import { topSellingVariants } from "../popular"

describe("topSellingVariants", () => {
  it("adds up quantities across orders, most sold first", () => {
    const orders = [
      { status: "pending", items: [{ variant_id: "a", quantity: 1 }, { variant_id: "b", quantity: 3 }] },
      { status: "completed", items: [{ variant_id: "a", quantity: 4 }, { variant_id: "c", quantity: 2 }] },
    ]
    expect(topSellingVariants(orders)).toEqual(["a", "b", "c"])
  })

  it("skips canceled orders and lines without a variant or quantity", () => {
    const orders = [
      { status: "canceled", items: [{ variant_id: "x", quantity: 100 }] },
      { status: "pending", items: [{ variant_id: null, quantity: 5 }, { variant_id: "y", quantity: 0 }, { variant_id: "z", quantity: "2" }] },
    ]
    expect(topSellingVariants(orders)).toEqual(["z"])
  })

  it("keeps a stable order on ties and respects the limit", () => {
    const orders = [{ status: "pending", items: ["d", "b", "c", "a"].map((id) => ({ variant_id: id, quantity: 1 })) }]
    expect(topSellingVariants(orders, 2)).toEqual(["a", "b"])
  })

  it("reads the quantity from the order item detail", () => {
    const orders = [{ status: "pending", items: [{ variant_id: "a", detail: { quantity: 3 } }, { variant_id: "b", detail: { quantity: 5 } }] }]
    expect(topSellingVariants(orders)).toEqual(["b", "a"])
  })

  it("is empty without orders", () => {
    expect(topSellingVariants([])).toEqual([])
  })
})
