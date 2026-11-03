// Giỏ "Mua lại" bản tạm (BE-9): đếm tần suất mua theo biến thể trong các đơn đã giao của khách.
// Module Predictive (LightGBM, AI #1) sẽ thay hàm này; hợp đồng response API-3 giữ nguyên.

export const REORDER_LIMIT = 5

export type PastOrder = {
  delivered_at: string // ISO, mốc DELIVERED trong stage_log
  lines: { variant_id: string; quantity: number }[]
}

export type ReorderPick = {
  variant_id: string
  quantity: number // số lượng khách hay mua nhất cho món này
  times: number // số đơn có món này
}

/**
 * Chọn tối đa `limit` biến thể khách hay mua lại nhất.
 * - Xếp theo số đơn có món đó (nhiều trước), bằng nhau thì món mua gần đây hơn trước, rồi theo
 *   variant_id để kết quả luôn cố định.
 * - Số lượng gợi ý là số lượng xuất hiện nhiều nhất trong các lần mua; hoà thì lấy số lớn hơn.
 * - Một đơn có cùng biến thể ở hai dòng thì cộng lại, vẫn tính là một lần mua.
 */
export function pickReorderItems(orders: PastOrder[], limit = REORDER_LIMIT): ReorderPick[] {
  const stats = new Map<string, { times: number; lastAt: string; quantities: number[] }>()

  for (const order of orders) {
    const perOrder = new Map<string, number>()
    for (const line of order.lines) {
      perOrder.set(line.variant_id, (perOrder.get(line.variant_id) ?? 0) + line.quantity)
    }
    for (const [variantId, quantity] of perOrder) {
      const s = stats.get(variantId) ?? { times: 0, lastAt: "", quantities: [] }
      s.times++
      s.quantities.push(quantity)
      if (order.delivered_at > s.lastAt) {
        s.lastAt = order.delivered_at
      }
      stats.set(variantId, s)
    }
  }

  return [...stats.entries()]
    .sort(
      ([idA, a], [idB, b]) =>
        b.times - a.times || b.lastAt.localeCompare(a.lastAt) || idA.localeCompare(idB)
    )
    .slice(0, limit)
    .map(([variant_id, s]) => ({ variant_id, quantity: mostCommon(s.quantities), times: s.times }))
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>()
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1))
  return [...counts.entries()].sort(([va, ca], [vb, cb]) => cb - ca || vb - va)[0][0]
}
