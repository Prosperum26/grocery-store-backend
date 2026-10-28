import { lowStockItems, summarizeOrders, vnDay, VariantStock } from "../summary"

// 29/10/2026 09:00 giờ VN
const NOW = new Date("2026-10-29T02:00:00Z")

describe("vnDay", () => {
  it("tính ngày theo giờ VN, không theo UTC", () => {
    expect(vnDay(new Date("2026-10-28T16:59:59Z"))).toBe("2026-10-28") // 23:59:59 VN
    expect(vnDay(new Date("2026-10-28T17:00:00Z"))).toBe("2026-10-29") // 00:00 VN
  })
})

describe("summarizeOrders", () => {
  it("không có đơn thì toàn 0, vẫn đủ 7 ngày", () => {
    expect(summarizeOrders([], NOW)).toEqual({
      revenue_today: 0,
      orders_today: 0,
      aov: 0,
      revenue_7d: [0, 0, 0, 0, 0, 0, 0],
    })
  })

  it("cộng theo ngày VN, hôm nay ở cuối, bỏ đơn huỷ, nháp và đơn ngoài 7 ngày", () => {
    const s = summarizeOrders(
      [
        { created_at: "2026-10-28T17:30:00Z", status: "pending", total: 100000 }, // hôm nay 00:30 VN
        { created_at: "2026-10-29T01:00:00Z", status: "completed", total: 50000 }, // hôm nay
        { created_at: "2026-10-28T16:00:00Z", status: "pending", total: 70000 }, // hôm qua 23:00 VN
        { created_at: "2026-10-23T05:00:00Z", status: "pending", total: 30000 }, // 6 ngày trước
        { created_at: "2026-10-22T05:00:00Z", status: "pending", total: 999000 }, // ngoài 7 ngày
        { created_at: "2026-10-29T01:00:00Z", status: "canceled", total: 888000 },
        { created_at: "2026-10-29T01:00:00Z", status: "draft", total: 777000 },
      ],
      NOW
    )
    expect(s.revenue_today).toBe(150000)
    expect(s.orders_today).toBe(2)
    expect(s.revenue_7d).toEqual([30000, 0, 0, 0, 0, 70000, 150000])
    // 4 đơn trong 7 ngày, tổng 250.000
    expect(s.aov).toBe(62500)
  })
})

describe("lowStockItems", () => {
  const v = (sku: string, available: number, low_stock = 10): VariantStock => ({
    product_id: `prod_${sku}`,
    title: sku,
    variant_title: "Gói",
    sku,
    available,
    low_stock,
  })

  it("lấy tồn <= ngưỡng (gồm hết hàng), ít hàng nhất trước", () => {
    const items = lowStockItems([v("a", 11), v("b", 10), v("c", 0), v("d", 3), v("e", 3), v("f", 6, 5)])
    expect(items.map((i) => i.sku)).toEqual(["c", "d", "e", "b"])
  })
})
