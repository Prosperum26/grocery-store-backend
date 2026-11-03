import { pickReorderItems, PastOrder } from "../reorder"

const order = (delivered_at: string, lines: [string, number][]): PastOrder => ({
  delivered_at,
  lines: lines.map(([variant_id, quantity]) => ({ variant_id, quantity })),
})

describe("pickReorderItems", () => {
  it("chưa có đơn đã giao thì rỗng", () => {
    expect(pickReorderItems([])).toEqual([])
  })

  it("xếp theo số đơn có món, nhiều trước", () => {
    const picks = pickReorderItems([
      order("2026-09-19T11:00:00Z", [["egg", 1], ["milk", 2]]),
      order("2026-09-28T05:00:00Z", [["egg", 1], ["milk", 2], ["banana", 1]]),
      order("2026-10-03T03:00:00Z", [["egg", 1]]),
    ])
    expect(picks.map((p) => [p.variant_id, p.times])).toEqual([["egg", 3], ["milk", 2], ["banana", 1]])
  })

  it("bằng số lần thì món mua gần đây hơn đứng trước", () => {
    const picks = pickReorderItems([
      order("2026-09-19T11:00:00Z", [["old", 1]]),
      order("2026-10-03T03:00:00Z", [["new", 1]]),
    ])
    expect(picks.map((p) => p.variant_id)).toEqual(["new", "old"])
  })

  it("hoà hoàn toàn thì theo variant_id để kết quả cố định", () => {
    const picks = pickReorderItems([order("2026-10-03T03:00:00Z", [["b", 1], ["a", 1]])])
    expect(picks.map((p) => p.variant_id)).toEqual(["a", "b"])
  })

  it("lấy tối đa 5 món", () => {
    const picks = pickReorderItems([
      order("2026-10-03T03:00:00Z", [["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1], ["f", 1]]),
    ])
    expect(picks).toHaveLength(5)
  })

  it("số lượng gợi ý là số lượng hay mua nhất, hoà thì lấy số lớn hơn", () => {
    const usual = pickReorderItems([
      order("2026-09-19T11:00:00Z", [["milk", 2]]),
      order("2026-09-28T05:00:00Z", [["milk", 2]]),
      order("2026-10-03T03:00:00Z", [["milk", 1]]),
    ])
    expect(usual[0].quantity).toBe(2)

    const tie = pickReorderItems([
      order("2026-09-19T11:00:00Z", [["rice", 1]]),
      order("2026-09-28T05:00:00Z", [["rice", 3]]),
    ])
    expect(tie[0].quantity).toBe(3)
  })

  it("cùng món hai dòng trong một đơn: cộng số lượng, tính một lần mua", () => {
    const picks = pickReorderItems([order("2026-10-03T03:00:00Z", [["egg", 1], ["egg", 2]])])
    expect(picks).toEqual([{ variant_id: "egg", quantity: 3, times: 1 }])
  })
})
