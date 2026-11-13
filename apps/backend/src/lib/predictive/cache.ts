/**
 * Predictive caching (tính năng 1 của proposal): thứ hạng "Mua lại" của model được giữ trong Redis để lần mở trang
 * sau không phải gọi AI service. Thiết kế: docs/02-architecture.md, khoá `basket:{customerId}`, TTL 30 phút, gia hạn
 * mỗi lần đọc; storefront gọi POST /store/predictive/warm khi khách đăng nhập để tính sẵn.
 *
 * Chỉ giữ THỨ HẠNG (danh sách variant_id). Giá, tồn kho và số lượng vẫn đọc mới mỗi lần, vì chúng đổi trong ngày còn
 * thứ hạng chỉ đổi khi khách có thêm đơn đã giao. Để không trả thứ hạng cũ sau một đơn mới, giá trị lưu kèm "phiên bản
 * lịch sử" (số đơn đã giao + thời điểm đơn mới nhất); khác phiên bản thì tính lại.
 */

/** Phần nhỏ của ioredis mà cache cần, để test thay bằng bản giả. */
export type CacheRedis = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
}

export const BASKET_TTL_SECONDS = 30 * 60

export const basketKey = (prefix: string, customerId: string) => `${prefix}basket:${customerId}`

/** Đổi khi khách có thêm đơn đã giao. */
export function historyVersion(delivered: { placed_at: string }[]): string {
  const newest = delivered.reduce((max, o) => (o.placed_at > max ? o.placed_at : max), "")
  return `${delivered.length}:${newest}`
}

export type CachedRanking = { ranking: string[]; source: "cache" | "model" }

/**
 * Thứ hạng từ Redis nếu còn và đúng phiên bản lịch sử (gia hạn TTL khi đọc), không thì gọi `compute` và lưu lại.
 * Model lỗi (danh sách rỗng) thì không lưu, để lần sau thử lại. Redis lỗi hoặc không có thì vẫn tính bình thường:
 * cache chỉ làm nhanh hơn, không được làm hỏng khối "Mua lại".
 */
export async function cachedRanking(
  redis: CacheRedis | null,
  key: string,
  version: string,
  compute: () => Promise<string[]>,
  onError: (message: string) => void = () => undefined
): Promise<CachedRanking> {
  if (redis) {
    try {
      const raw = await redis.get(key)
      if (raw) {
        const saved = JSON.parse(raw) as { v?: string; ranking?: unknown }
        if (saved.v === version && Array.isArray(saved.ranking)) {
          await redis.expire(key, BASKET_TTL_SECONDS)
          return { ranking: saved.ranking as string[], source: "cache" }
        }
      }
    } catch (e) {
      onError(`reorder cache read failed: ${(e as Error).message}`)
    }
  }

  const ranking = await compute()
  if (redis && ranking.length > 0) {
    try {
      await redis.set(key, JSON.stringify({ v: version, ranking }), "EX", BASKET_TTL_SECONDS)
    } catch (e) {
      onError(`reorder cache write failed: ${(e as Error).message}`)
    }
  }
  return { ranking, source: "model" }
}
