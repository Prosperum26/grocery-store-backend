// Số liệu cho widget Tổng quan và Sắp cạn kho của Admin (BE-11, API-9). Hàm thuần, không đọc DB.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_LOW_STOCK = 10 // như storefront (viewmodels/product.ts) khi sản phẩm không có metadata.low_stock

/** Ngày theo giờ Việt Nam, dạng "2026-10-29", không phụ thuộc múi giờ máy chủ. */
export function vnDay(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

export type OrderForSummary = { created_at: string | Date; status: string; total: number }

export type DashboardSummary = {
  revenue_today: number
  orders_today: number
  aov: number // giá trị đơn trung bình của 7 ngày, làm tròn tới đồng
  low_stock_count: number
  revenue_7d: number[] // 7 phần tử, cũ nhất trước, phần tử cuối là hôm nay
}

/**
 * Doanh thu và số đơn theo ngày tạo đơn (giờ VN). Bỏ đơn đã huỷ và đơn nháp.
 * Doanh thu tính theo tổng tiền đơn (gồm phí giao, đã trừ giảm giá), không theo tiền đã thu.
 */
export function summarizeOrders(
  orders: OrderForSummary[],
  now: Date
): Omit<DashboardSummary, "low_stock_count"> {
  const days = Array.from({ length: 7 }, (_, i) => vnDay(new Date(now.getTime() - (6 - i) * DAY_MS)))
  const revenue = new Map(days.map((d) => [d, 0]))
  const count = new Map(days.map((d) => [d, 0]))

  for (const order of orders) {
    if (order.status === "canceled" || order.status === "draft") {
      continue
    }
    const day = vnDay(new Date(order.created_at))
    if (revenue.has(day)) {
      revenue.set(day, revenue.get(day)! + Number(order.total))
      count.set(day, count.get(day)! + 1)
    }
  }

  const today = days[6]
  const revenue7d = days.map((d) => revenue.get(d)!)
  const orders7d = days.reduce((sum, d) => sum + count.get(d)!, 0)
  const total7d = revenue7d.reduce((sum, v) => sum + v, 0)
  return {
    revenue_today: revenue.get(today)!,
    orders_today: count.get(today)!,
    aov: orders7d ? Math.round(total7d / orders7d) : 0,
    revenue_7d: revenue7d,
  }
}

export type VariantStock = {
  product_id: string
  title: string // tên sản phẩm
  variant_title: string
  sku: string
  available: number
  low_stock: number
}

/**
 * Biến thể sắp cạn: tồn khả dụng <= ngưỡng low_stock của sản phẩm, gồm cả hết hàng (0). Cùng quy tắc
 * với nhãn "Còn N" / "Hết hàng" của storefront. Xếp ít hàng nhất trước, bằng nhau thì theo sku.
 */
export function lowStockItems(variants: VariantStock[]): VariantStock[] {
  return variants
    .filter((v) => v.available <= v.low_stock)
    .sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku))
}
