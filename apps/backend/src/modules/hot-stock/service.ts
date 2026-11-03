import type Redis from "ioredis"
import { REDIS_CLIENT, type HotStockOptions } from "./types"

type InjectedDependencies = { [REDIS_CLIENT]: Redis }

/**
 * Cổng giữ hàng bằng Redis (plan hot-stock). HS-1 mới có kết nối; các hàm reserve, release, confirm,
 * expireDue, syncItems thêm ở HS-2 và HS-3.
 */
export default class HotStockModuleService {
  protected readonly redis: Redis
  readonly prefix: string
  readonly holdTtlSeconds: number

  constructor(deps: InjectedDependencies, options: HotStockOptions) {
    this.redis = deps[REDIS_CLIENT]
    this.prefix = options.prefix ?? "c4f:"
    this.holdTtlSeconds = options.holdTtlSeconds ?? 900
  }

  /** "PONG" khi Redis trả lời. */
  async ping(): Promise<string> {
    return this.redis.ping()
  }

  __hooks = {
    // Đóng kết nối khi Medusa tắt, để tiến trình (và jest) thoát gọn.
    onApplicationShutdown: async () => {
      await this.redis.quit().catch(() => this.redis.disconnect())
    },
  }
}
