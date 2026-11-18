import { vnDay } from "../dashboard/summary"

/**
 * Mã hiển thị của đơn, cùng dạng với đơn demo (`C4F-261007-0142`): ngày đặt theo giờ Việt Nam (YYMMDD)
 * và `display_id` đủ 4 chữ số. `display_id` là duy nhất nên mã cũng duy nhất; quá 9999 thì dài hơn 4 số.
 */
export function orderCode(createdAt: Date, displayId: number): string {
  const day = vnDay(createdAt).replace(/-/g, "").slice(2)
  return `C4F-${day}-${String(displayId).padStart(4, "0")}`
}
