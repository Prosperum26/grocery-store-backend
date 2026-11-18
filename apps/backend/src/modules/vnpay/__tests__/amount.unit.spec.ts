import { fromVnpAmount, toVnpAmount } from "../lib/amount"

describe("vnpay amount", () => {
  it("toVnpAmount nhân 100 (VND đồng -> đơn vị VNPAY)", () => {
    expect(toVnpAmount(390000)).toBe(39000000)
  })

  it("fromVnpAmount là phép ngược lại", () => {
    expect(fromVnpAmount(39000000)).toBe(390000)
    expect(fromVnpAmount(toVnpAmount(15000))).toBe(15000)
  })

  it("VND không có phần lẻ: số lẻ bị từ chối", () => {
    expect(() => toVnpAmount(1500.5)).toThrow()
    expect(() => fromVnpAmount(15000)).not.toThrow()
    expect(() => fromVnpAmount(150)).toThrow() // 150 / 100 = 1.5 đồng
    expect(() => fromVnpAmount(Number("abc"))).toThrow()
  })
})
