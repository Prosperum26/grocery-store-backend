import { buildPredictRequest, estimateDaysLeft, hasReorderHistory, orderPlacedAt, PastOrder, usualQuantities } from "../reorder"

const order = (placed_at: string, lines: [string, number][]): PastOrder => ({
  placed_at,
  lines: lines.map(([variant_id, quantity]) => ({ variant_id, quantity })),
})

describe("estimateDaysLeft", () => {
  const history = [
    order("2026-10-01T00:00:00.000Z", [["often", 1]]),
    order("2026-10-08T00:00:00.000Z", [["often", 1], ["once", 1]]),
    order("2026-10-15T00:00:00.000Z", [["often", 1]]),
  ]

  it("tính từ chu kỳ riêng của món", () => {
    expect(estimateDaysLeft(history, new Date("2026-10-17T00:00:00.000Z")).get("often")).toBe(5)
  })

  it("món mua một lần dùng chu kỳ đơn của khách", () => {
    expect(estimateDaysLeft(history, new Date("2026-10-10T00:00:00.000Z")).get("once")).toBe(5)
  })

  it("đã qua hạn thì là 0", () => {
    expect(estimateDaysLeft(history, new Date("2026-11-30T00:00:00.000Z")).get("often")).toBe(0)
  })

  it("đơn không còn món không làm lệch chu kỳ", () => {
    const withEmpty = [...history, order("2026-10-03T00:00:00.000Z", [])]
    expect(estimateDaysLeft(withEmpty, new Date("2026-10-10T00:00:00.000Z")).get("once")).toBe(5)
  })
})

describe("hasReorderHistory", () => {
  const withItems = order("2026-09-19T00:00:00.000Z", [["v1", 1]])
  const noItems = order("2026-09-20T00:00:00.000Z", [])

  it("cần từ 2 đơn có món trở lên", () => {
    expect(hasReorderHistory([])).toBe(false)
    expect(hasReorderHistory([withItems])).toBe(false)
    expect(hasReorderHistory([withItems, withItems])).toBe(true)
  })

  it("không tính đơn không còn món", () => {
    expect(hasReorderHistory([withItems, noItems])).toBe(false)
  })
})

describe("orderPlacedAt", () => {
  const createdAt = "2026-11-01T00:00:00.000Z"

  it("lấy mốc đầu tiên trong stage_log", () => {
    const log = [
      { stage: "PENDING", at: "2026-09-19T11:00:00+07:00" },
      { stage: "DELIVERED", at: "2026-09-20T11:00:00+07:00" },
    ]
    expect(orderPlacedAt(log, createdAt)).toBe("2026-09-19T04:00:00.000Z")
  })

  it("không có stage_log hoặc mốc sai thì dùng created_at", () => {
    expect(orderPlacedAt(undefined, createdAt)).toBe(createdAt)
    expect(orderPlacedAt([], new Date(createdAt))).toBe(createdAt)
    expect(orderPlacedAt([{ at: "không phải ngày" }], createdAt)).toBe(createdAt)
  })
})

describe("buildPredictRequest", () => {
  it("gửi variant_id làm product_id, kèm danh mục, null khi không có", () => {
    const body = buildPredictRequest(
      [order("2026-10-03T03:00:00.000Z", [["egg", 1], ["gone", 2]])],
      new Map([["egg", "trung-sua"]])
    )
    expect(body).toEqual({
      top_k: 14,
      orders: [
        {
          placed_at: "2026-10-03T03:00:00.000Z",
          lines: [
            { product_id: "egg", category: "trung-sua" },
            { product_id: "gone", category: null },
          ],
        },
      ],
    })
  })

  it("bỏ đơn không còn dòng nào", () => {
    const body = buildPredictRequest([order("2026-10-03T03:00:00.000Z", [])], new Map())
    expect(body.orders).toEqual([])
  })

  it("giữ 500 đơn gần nhất", () => {
    const orders = Array.from({ length: 501 }, (_, i) =>
      order(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(), [["a", 1]])
    )
    const body = buildPredictRequest(orders, new Map())
    expect(body.orders).toHaveLength(500)
    expect(body.orders.map((o) => o.placed_at)).not.toContain(orders[0].placed_at)
  })
})

describe("usualQuantities", () => {
  it("số lượng hay mua nhất, hoà thì lấy số lớn hơn", () => {
    const usual = usualQuantities([
      order("2026-09-19T11:00:00Z", [["milk", 2], ["rice", 1]]),
      order("2026-09-28T05:00:00Z", [["milk", 2], ["rice", 3]]),
      order("2026-10-03T03:00:00Z", [["milk", 1]]),
    ])
    expect(usual.get("milk")).toBe(2)
    expect(usual.get("rice")).toBe(3)
  })

  it("cùng món hai dòng trong một đơn thì cộng số lượng", () => {
    const usual = usualQuantities([order("2026-10-03T03:00:00Z", [["egg", 1], ["egg", 2]])])
    expect(usual.get("egg")).toBe(3)
  })
})
