/**
 * "Mua lại" cho khách chưa đủ lịch sử (proposal: dùng top bán chạy của kho thay cho model). Hàm thuần: đếm số lượng
 * đã bán theo biến thể trong các đơn gần đây, đơn đã huỷ không tính. Đọc đơn và tồn kho ở workflow get-reorder-basket.
 */

export const POPULAR_DAYS = 30
export const POPULAR_POOL = 15 // xin nhiều hơn số món hiện, vì món hết hàng hoặc đang ẩn bị bỏ sau đó

// Số lượng của dòng đơn nằm ở `detail.quantity` (bảng order_item): query.graph không trả `items.quantity` nếu không
// xin kèm các trường tổng tiền, nên đọc detail trước.
export type SoldOrder = {
  status?: string | null
  items?: { variant_id?: string | null; quantity?: unknown; detail?: { quantity?: unknown } | null }[] | null
}

/** Biến thể bán chạy nhất, nhiều trước; hoà thì theo id để thứ tự ổn định. */
export function topSellingVariants(orders: SoldOrder[], limit = POPULAR_POOL): string[] {
  const sold = new Map<string, number>()
  for (const order of orders) {
    if (order.status === "canceled") continue
    for (const item of order.items ?? []) {
      const qty = Number(item.detail?.quantity ?? item.quantity)
      if (!item.variant_id || !(qty > 0)) continue
      sold.set(item.variant_id, (sold.get(item.variant_id) ?? 0) + qty)
    }
  }
  return [...sold.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id)
}
