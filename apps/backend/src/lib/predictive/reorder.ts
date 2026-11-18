// Hàm thuần cho giỏ "Mua lại": tạo body gửi model (grocery-store-ai) và tính số lượng gợi ý.
// Model chỉ xếp hạng món, không dự đoán số lượng.

export const REORDER_LIMIT = 5
export const SCHEDULE_TODAY_LIMIT = 10
// Xin dư để bù món ẩn hoặc đã xoá. Khác 15 nên AI không áp ngưỡng τ (τ làm giảm chỉ số top-5).
export const PREDICT_TOP_K = 14
const DAY_MS = 86_400_000
const MAX_ORDERS = 500 // giới hạn của /predict
const MIN_ORDERS = 2 // khách mua trên 1 đơn mới có gợi ý

export type PastOrder = {
  placed_at: string // ISO
  lines: { variant_id: string; quantity: number }[]
}

export type PredictRequest = {
  top_k: number
  orders: {
    placed_at: string
    lines: { product_id: string; category: string | null }[]
  }[]
}

/** Đủ lịch sử để gợi ý: từ 2 đơn đã giao còn món trở lên. */
export function hasReorderHistory(orders: PastOrder[]): boolean {
  return orders.filter((o) => o.lines.length > 0).length >= MIN_ORDERS
}

/**
 * Thời điểm đặt đơn: mốc đầu tiên trong stage_log, vì created_at của đơn demo là lúc seed.
 * Không có mốc hợp lệ thì dùng created_at.
 */
export function orderPlacedAt(stageLog: unknown, createdAt: string | Date): string {
  const first = Array.isArray(stageLog) ? new Date(stageLog[0]?.at) : null
  return first && !isNaN(first.getTime()) ? first.toISOString() : new Date(createdAt).toISOString()
}

/** `product_id` gửi đi là variant_id: catalog có một biến thể mỗi sản phẩm. */
export function buildPredictRequest(orders: PastOrder[], categoryOf: Map<string, string>): PredictRequest {
  return {
    top_k: PREDICT_TOP_K,
    orders: orders
      .filter((o) => o.lines.length > 0)
      .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      .slice(0, MAX_ORDERS)
      .map((o) => ({
        placed_at: o.placed_at,
        lines: o.lines.map((l) => ({
          product_id: l.variant_id,
          category: categoryOf.get(l.variant_id) ?? null,
        })),
      })),
  }
}

/**
 * Số lượng gợi ý cho từng biến thể: số xuất hiện nhiều nhất trong các lần mua, hoà thì lấy số lớn hơn.
 * Một đơn có cùng biến thể ở hai dòng thì cộng lại, vẫn tính là một lần mua.
 */
export function usualQuantities(orders: PastOrder[]): Map<string, number> {
  const purchases = new Map<string, number[]>()
  for (const order of orders) {
    const perOrder = new Map<string, number>()
    for (const line of order.lines) {
      perOrder.set(line.variant_id, (perOrder.get(line.variant_id) ?? 0) + line.quantity)
    }
    for (const [variantId, quantity] of perOrder) {
      purchases.set(variantId, [...(purchases.get(variantId) ?? []), quantity])
    }
  }
  return new Map([...purchases].map(([variantId, values]) => [variantId, mostCommon(values)]))
}

/**
 * Số ngày ước tính đến lần mua lại của từng biến thể: lần mua gần nhất + chu kỳ - hôm nay, tối thiểu 0.
 * Chu kỳ là trung vị khoảng cách giữa các lần mua món đó. Món mới mua một lần chưa có chu kỳ riêng
 * nên dùng trung vị khoảng cách giữa các đơn của khách.
 */
export function estimateDaysLeft(orders: PastOrder[], now: Date): Map<string, number> {
  const times = (list: string[]) => [...new Set(list.map((t) => new Date(t).getTime()))].sort((a, b) => a - b)
  const withLines = orders.filter((o) => o.lines.length > 0)
  const orderCycle = medianGapDays(times(withLines.map((o) => o.placed_at)))

  const purchases = new Map<string, string[]>()
  for (const order of withLines) {
    for (const { variant_id } of order.lines) {
      purchases.set(variant_id, [...(purchases.get(variant_id) ?? []), order.placed_at])
    }
  }

  const result = new Map<string, number>()
  for (const [variantId, placedAt] of purchases) {
    const bought = times(placedAt)
    const cycle = medianGapDays(bought) ?? orderCycle ?? 0
    const due = bought[bought.length - 1] + cycle * DAY_MS
    result.set(variantId, Math.max(0, Math.ceil((due - now.getTime()) / DAY_MS)))
  }
  return result
}

function medianGapDays(sortedTimes: number[]): number | null {
  const gaps = sortedTimes.slice(1).map((t, i) => (t - sortedTimes[i]) / DAY_MS).sort((a, b) => a - b)
  if (!gaps.length) {
    return null
  }
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>()
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1))
  return [...counts.entries()].sort(([va, ca], [vb, cb]) => cb - ca || vb - va)[0][0]
}
