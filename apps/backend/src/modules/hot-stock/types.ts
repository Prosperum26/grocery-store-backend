// Options của module hot-stock, khai báo trong medusa-config.ts.
export type HotStockOptions = {
  /** Ví dụ redis://localhost:6379 */
  redisUrl: string
  /** Tiền tố cho mọi key, để dev và test không đụng nhau. Mặc định "c4f:". */
  prefix?: string
  /** Thời gian giữ hàng (giây). Mặc định 900 (15 phút, plan D2). */
  holdTtlSeconds?: number
  /** Phát thay đổi tồn lên kênh Pub/Sub cho gateway real-time. Mặc định true. */
  publish?: boolean
}

/** Tên đăng ký kết nối Redis trong container riêng của module (loader đặt, service đọc). */
export const REDIS_CLIENT = "hotStockRedis"
