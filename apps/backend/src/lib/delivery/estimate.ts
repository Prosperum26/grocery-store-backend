// O5: chưa có geocoding nên quãng đường lấy từ bảng cố định theo quận, tính từ Kho Q.7.
// Số km là ước lượng thủ công (không đo bằng bản đồ), đủ để hiện "dự kiến tới lúc ...".
// Khoá viết thường, không dấu, đúng dạng mà `normalize` trả ra.
const DISTRICT_KM: Record<string, number> = {
  "quan 1": 10,
  "quan 3": 9,
  "quan 4": 4,
  "quan 5": 7,
  "quan 7": 3,
  "quan 8": 5.5,
  "quan 10": 9,
  "binh thanh": 11,
}

// Quận không có trong bảng (hoặc địa chỉ không ghi quận) dùng khoảng cách này.
export const DEFAULT_DISTANCE_KM = 6

// Tốc độ giả định của tài xế: 20 km/h = 3 phút mỗi km.
export const SPEED_KMH = 20

// "  Quận 7 " / "Q.7" / "quan 7" -> "quan 7": bỏ dấu, hạ chữ thường, đổi "q." hoặc "q" + số thành "quan".
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\bq\.?\s*(\d)/g, "quan $1")
    .replace(/\s+/g, " ")
    .trim()
}

// Tìm quận trong chuỗi địa chỉ. Không cho "quan 1" khớp nhầm vào "quan 12" (chữ số liền sau).
function findDistrictKm(text: string): number | undefined {
  const normalized = normalize(text)
  for (const [district, km] of Object.entries(DISTRICT_KM)) {
    if (new RegExp(`(^|[^\\d])${district}(?!\\d)`).test(normalized)) {
      return km
    }
  }
  return undefined
}

/**
 * Ước giờ tới: quãng đường (km) / 20 km/h, làm tròn lên phút, cộng vào `startedAt`.
 * `address` là chuỗi địa chỉ có thể chứa tên quận; thiếu hoặc không nhận ra thì dùng 6 km.
 */
export function estimateDelivery(
  address: string | undefined,
  startedAt: Date
): { distanceKm: number; minutes: number; etaAt: Date } {
  const distanceKm = (address ? findDistrictKm(address) : undefined) ?? DEFAULT_DISTANCE_KM
  // Nhân trước rồi mới chia để km nguyên cho ra phút nguyên, tránh ceil(9.000000000000002) = 10.
  const minutes = Math.ceil((distanceKm * 60) / SPEED_KMH)
  return { distanceKm, minutes, etaAt: new Date(startedAt.getTime() + minutes * 60 * 1000) }
}
