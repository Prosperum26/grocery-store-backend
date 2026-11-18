// D2: PENDING -> CONFIRMED -> PREPARING -> SHIPPING -> DELIVERED; CANCELLED từ PENDING | CONFIRMED | PREPARING.
export const STAGES = ["PENDING", "CONFIRMED", "PREPARING", "SHIPPING", "DELIVERED", "CANCELLED"] as const

export type OrderStage = (typeof STAGES)[number]

// Các bước đi tiến theo thứ tự; CANCELLED nằm ngoài chuỗi này.
const FORWARD: OrderStage[] = ["PENDING", "CONFIRMED", "PREPARING", "SHIPPING", "DELIVERED"]
const CANCELLABLE: OrderStage[] = ["PENDING", "CONFIRMED", "PREPARING"]

/**
 * Chuyển từ `from` sang `to` có hợp lệ không. Từ `undefined` (đơn chưa có stage) chỉ vào PENDING.
 * Chỉ được tiến (cho phép nhảy bước, vì Admin có thể tạo fulfillment khi chưa bấm xác nhận);
 * không lùi, không "chuyển" về chính nó; DELIVERED và CANCELLED là điểm cuối.
 */
export function canTransition(from: OrderStage | undefined, to: OrderStage): boolean {
  if (from === undefined) {
    return to === "PENDING"
  }
  if (to === "CANCELLED") {
    return CANCELLABLE.includes(from)
  }
  const fromIndex = FORWARD.indexOf(from)
  return fromIndex !== -1 && FORWARD.indexOf(to) > fromIndex
}

/**
 * Suy stage từ trạng thái Medusa của đơn, dùng cho đơn cũ chưa có `metadata.stage` (script backfill).
 * Trạng thái "một phần" xếp vào bước chưa hoàn tất.
 */
export function deriveStage(order: { status: string; fulfillment_status: string }): OrderStage {
  if (order.status === "canceled" || order.fulfillment_status === "canceled") {
    return "CANCELLED"
  }
  switch (order.fulfillment_status) {
    case "delivered":
      return "DELIVERED"
    case "shipped":
    case "partially_shipped":
    case "partially_delivered":
      return "SHIPPING"
    case "fulfilled":
    case "partially_fulfilled":
      return "PREPARING"
    default:
      return "PENDING"
  }
}
