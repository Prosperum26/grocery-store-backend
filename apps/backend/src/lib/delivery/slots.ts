export type DeliverySlot = {
  /** Giờ bắt đầu theo giờ VN, dạng "2026-10-26T08". */
  id: string
  label: string
  startsAt: string
  endsAt: string
  fee: number
  available: boolean
}

// Phí giao cố định mọi khung giờ (D5), VND là số nguyên đồng.
export const DELIVERY_FEE_VND = 15000

// Khung giờ trong ngày [giờ bắt đầu, giờ kết thúc], lấy từ thiết kế (pages_b.js, mục "Thời gian giao").
const DAILY_SLOT_HOURS: [number, number][] = [
  [7, 9],
  [15, 17],
  [17, 19],
  [19, 21],
]

// Khung bắt đầu sớm hơn mức này kể từ lúc đặt thì đóng (kịp soạn hàng).
const MIN_LEAD_MS = 60 * 60 * 1000

// Giờ VN = UTC+7, không có giờ mùa hè. Mọi phép tính dùng getUTC* trên mốc đã dịch
// 7 giờ nên không phụ thuộc múi giờ của máy chạy.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, "0")

// Mốc thời gian (ms UTC) -> "2026-10-27T07:00:00+07:00".
const toVnIso = (ms: number) =>
  new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19) + "+07:00"

/**
 * Các khung giờ giao của `days` ngày (mặc định 2: hôm nay và ngày mai) tính từ
 * ngày hiện tại theo giờ VN, kể cả khung đã qua (available: false).
 */
export function listSlots(now: Date, opts: { days?: number } = {}): DeliverySlot[] {
  const days = opts.days ?? 2

  // 00:00 hôm nay theo giờ VN, tính bằng ms UTC.
  const startOfTodayVn = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS

  const slots: DeliverySlot[] = []
  for (let day = 0; day < days; day++) {
    const dayStart = startOfTodayVn + day * DAY_MS
    const date = new Date(dayStart + VN_OFFSET_MS).toISOString().slice(0, 10)

    for (const [startHour, endHour] of DAILY_SLOT_HOURS) {
      const startsAt = dayStart + startHour * 60 * 60 * 1000
      const endsAt = dayStart + endHour * 60 * 60 * 1000
      slots.push({
        id: `${date}T${pad(startHour)}`,
        label: `${pad(startHour)}:00–${pad(endHour)}:00`,
        startsAt: toVnIso(startsAt),
        endsAt: toVnIso(endsAt),
        fee: DELIVERY_FEE_VND,
        available: startsAt - now.getTime() >= MIN_LEAD_MS,
      })
    }
  }
  return slots
}
