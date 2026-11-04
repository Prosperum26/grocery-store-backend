import type Redis from "ioredis"
import { hotStockKeys, type HotStockKeys, type StockRef } from "./lib/keys"
import { CONFIRM_HOLD_LUA } from "./lua/confirm-hold"
import { RELEASE_HOLD_LUA } from "./lua/release-hold"
import { RESERVE_HOLD_LUA } from "./lua/reserve-hold"
import { SYNC_ITEM_LUA } from "./lua/sync-item"
import { REDIS_CLIENT, type HotStockOptions } from "./types"

type InjectedDependencies = { [REDIS_CLIENT]: Redis }

export type HoldLine = StockRef & { quantity: number }

/** Kết quả giữ hàng. `line` là vị trí (từ 0) trong `lines` truyền vào. */
export type ReserveResult =
  | { status: "held"; expires_at: number }
  | { status: "out_of_stock"; line: number }
  | { status: "missing_stock_key"; line?: number }
  | { status: "duplicate_line"; line: number }
  | { status: "invalid"; line?: number }
  | { status: "confirmed" }

export type HoldStatus = "HELD" | "CONFIRMED" | "RELEASED" | "EXPIRED"
export type Hold = { cart_id: string; status: HoldStatus; expires_at: number; attempt: number; lines: { avail_key: string; quantity: number }[] }

// Script trả -4 khi hold đổi giữa lúc service đọc và lúc script chạy (nhiều lần gọi cùng giỏ một lúc).
// Đọc lại tối đa chừng này lần, nghỉ ngẫu nhiên vài ms giữa các lần để không giẫm lên nhau mãi.
const MAX_ATTEMPTS = 5
const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * (attempt + 1)))
const nowSeconds = () => Math.floor(Date.now() / 1000)

// Tên lệnh đăng ký bằng defineCommand: ioredis gửi EVALSHA, script chỉ nạp một lần cho mỗi kết nối.
type HoldCommands = {
  c4fReserveHold(numKeys: number, ...args: (string | number)[]): Promise<[number, number]>
  c4fReleaseHold(numKeys: number, ...args: (string | number)[]): Promise<number>
  c4fConfirmHold(numKeys: number, ...args: (string | number)[]): Promise<number>
  c4fSyncItem(numKeys: number, ...args: (string | number)[]): Promise<[number, number, number]>
}

/** Một món cần đặt lại: `postgres_available` = stocked − reserved của inventory level. */
export type SyncEntry = { ref: StockRef; postgres_available: number }
/** Kết quả đặt lại theo lô: `created` = món chưa có key, `changed` = món có key nhưng số khác (lệch). */
export type SyncSummary = { synced: number; created: number; changed: number }

// Số lệnh đặt lại gửi trong một pipeline (2.129 món của catalog = 5 lượt).
const SYNC_BATCH = 500

/**
 * Cổng giữ hàng bằng Redis (docs/plans/2026-11-03-redis-hot-stock.md). Mọi thay đổi số tồn chạy trong
 * script Lua nên nguyên tử; service chỉ dựng key, gọi script và đổi mã trả về thành kết quả có tên.
 */
export default class HotStockModuleService {
  protected readonly redis: Redis & HoldCommands
  readonly prefix: string
  readonly holdTtlSeconds: number
  readonly keys: HotStockKeys
  /** Kênh Pub/Sub nhận `{ location_id, inventory_item_id, available }` mỗi khi số còn giữ được đổi (HS-8). */
  readonly channel: string

  constructor(deps: InjectedDependencies, options: HotStockOptions) {
    this.redis = deps[REDIS_CLIENT] as Redis & HoldCommands
    this.prefix = options.prefix ?? "c4f:"
    this.holdTtlSeconds = options.holdTtlSeconds ?? 900
    this.keys = hotStockKeys(this.prefix)
    this.channel = options.publish === false ? "" : `${this.prefix}channel:inventory_events`
    this.redis.defineCommand("c4fReserveHold", { lua: RESERVE_HOLD_LUA })
    this.redis.defineCommand("c4fReleaseHold", { lua: RELEASE_HOLD_LUA })
    this.redis.defineCommand("c4fConfirmHold", { lua: CONFIRM_HOLD_LUA })
    this.redis.defineCommand("c4fSyncItem", { lua: SYNC_ITEM_LUA })
  }

  /** "PONG" khi Redis trả lời. */
  async ping(): Promise<string> {
    return this.redis.ping()
  }

  /**
   * Giữ hàng cho cả giỏ (hold id = cart id, plan D5). Gọi lại khi giỏ đang HELD thì thay hold cũ bằng
   * giỏ mới và tính lại hạn; hold cũ đã RELEASED/EXPIRED thì giữ lại từ đầu.
   */
  async reserve(input: { cart_id: string; lines: HoldLine[]; now?: number; ttl?: number }): Promise<ReserveResult> {
    const { cart_id, lines } = input
    if (!lines.length) {
      return { status: "invalid" }
    }
    // Script nhận số lượng 0 (món chỉ có trong hold cũ), nên dòng của giỏ mới phải kiểm > 0 ở đây.
    const bad = lines.findIndex((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)
    if (bad >= 0) {
      return { status: "invalid", line: bad }
    }
    const newKeys = lines.map((line) => this.keys.avail(line))
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Món chỉ có trong hold cũ cũng phải nằm trong KEYS (với số lượng 0) để script trả hàng của nó.
      const oldKeys = (await this.readHoldLines(cart_id)).map((line) => line.avail_key)
      const pairs = [...newKeys, ...oldKeys.filter((key) => !newKeys.includes(key))]
      const quantities = pairs.map((_, j) => (j < lines.length ? lines[j].quantity : 0))
      const [code, detail] = await this.redis.c4fReserveHold(
        2 + pairs.length * 2,
        this.keys.hold(cart_id),
        this.keys.expiry(),
        ...pairs.flatMap((key) => [key, this.keys.heldFromAvail(key)]),
        cart_id,
        input.now ?? nowSeconds(),
        input.ttl ?? this.holdTtlSeconds,
        this.channel,
        ...quantities
      )
      // detail là vị trí cặp (từ 1); cặp sau `lines` là món chỉ có trong hold cũ.
      const line = detail >= 1 && detail <= lines.length ? detail - 1 : undefined
      switch (code) {
        case 1:
          return { status: "held", expires_at: detail }
        case 0:
          return { status: "out_of_stock", line: line! }
        case -1:
          return { status: "missing_stock_key", line }
        case -3:
          return { status: "duplicate_line", line: line! }
        case 3:
          return { status: "confirmed" }
        case -4:
          await backoff(attempt)
          continue
        default:
          return { status: "invalid", line }
      }
    }
    throw new Error(`hot-stock: hold of ${cart_id} kept changing, gave up after ${MAX_ATTEMPTS} attempts`)
  }

  /** Trả hàng của hold (status RELEASED: thanh toán lỗi, khách bỏ; EXPIRED: job hết hạn). */
  async release(cartId: string, status: "RELEASED" | "EXPIRED" = "RELEASED"): Promise<"released" | "noop" | "confirmed"> {
    const code = await this.runOnHold(cartId, (keys) => this.redis.c4fReleaseHold(keys.length, ...keys, cartId, status, this.channel))
    return code === 1 ? "released" : code === -1 ? "confirmed" : "noop"
  }

  /** Giỏ đã thành đơn: hold thành CONFIRMED, Medusa giữ phần đó bằng reservation. */
  async confirm(cartId: string): Promise<"confirmed" | "already_confirmed" | "not_held"> {
    const code = await this.runOnHold(cartId, (keys) => this.redis.c4fConfirmHold(keys.length, ...keys, cartId))
    return code === 1 ? "confirmed" : code === 2 ? "already_confirmed" : "not_held"
  }

  /**
   * Job hết hạn: trả hàng của các hold có hạn <= now (tối đa `limit` hold mỗi lần, như repo thử).
   * Trả số hold thực sự được trả; chạy song song hay chạy lại cũng không trả hai lần.
   */
  async expireDue(input: { now?: number; limit?: number } = {}): Promise<number> {
    const due = await this.redis.zrangebyscore(this.keys.expiry(), "-inf", input.now ?? nowSeconds(), "LIMIT", 0, input.limit ?? 200)
    let released = 0
    for (const cartId of due) {
      if ((await this.release(cartId, "EXPIRED")) === "released") {
        released++
      }
    }
    return released
  }

  /** Đặt lại số còn giữ được của một món từ `stocked − reserved` của Postgres. Trả avail mới. */
  async syncItem(ref: StockRef, postgresAvailable: number): Promise<number> {
    const [avail] = await this.redis.c4fSyncItem(2, this.keys.avail(ref), this.keys.held(ref), postgresAvailable, this.channel)
    return avail
  }

  /**
   * Đặt lại nhiều món, gửi theo pipeline. Mỗi món vẫn là một lần chạy script riêng (nguyên tử theo món);
   * pipeline chỉ gộp đường truyền. Đếm món mới và món bị lệch để job đối soát ghi log.
   */
  async syncItems(entries: SyncEntry[]): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, created: 0, changed: 0 }
    for (let i = 0; i < entries.length; i += SYNC_BATCH) {
      const pipeline = this.redis.pipeline() as unknown as HoldCommands & { exec(): Promise<[Error | null, unknown][] | null> }
      for (const { ref, postgres_available } of entries.slice(i, i + SYNC_BATCH)) {
        pipeline.c4fSyncItem(2, this.keys.avail(ref), this.keys.held(ref), postgres_available, this.channel)
      }
      for (const [error, reply] of (await pipeline.exec()) ?? []) {
        if (error) {
          throw error
        }
        const [avail, existed, old] = reply as [number, number, number]
        summary.synced++
        if (!existed) {
          summary.created++
        } else if (old !== avail) {
          summary.changed++
        }
      }
    }
    return summary
  }

  /** Số còn giữ được của các món (null = chưa đồng bộ). */
  async available(refs: StockRef[]): Promise<(number | null)[]> {
    if (!refs.length) {
      return []
    }
    const values = await this.redis.mget(...refs.map((ref) => this.keys.avail(ref)))
    return values.map((value) => (value === null ? null : Number(value)))
  }

  /** Hold của giỏ, hoặc null nếu chưa có (hoặc đã quá một ngày sau khi kết thúc). */
  async getHold(cartId: string): Promise<Hold | null> {
    const hash = await this.redis.hgetall(this.keys.hold(cartId))
    if (!hash.__status) {
      return null
    }
    return {
      cart_id: cartId,
      status: hash.__status as HoldStatus,
      expires_at: Number(hash.__exp),
      attempt: Number(hash.__attempt ?? 1),
      lines: this.linesOf(hash),
    }
  }

  private linesOf(hash: Record<string, string>) {
    return Object.entries(hash)
      .filter(([field]) => !field.startsWith("__"))
      .map(([avail_key, quantity]) => ({ avail_key, quantity: Number(quantity) }))
  }

  private async readHoldLines(cartId: string) {
    return this.linesOf(await this.redis.hgetall(this.keys.hold(cartId)))
  }

  // Release và confirm cần key của mọi món trong hold: đọc hold, dựng KEYS, chạy script; -4 thì đọc lại.
  private async runOnHold(cartId: string, run: (keys: string[]) => Promise<number>): Promise<number> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const lines = await this.readHoldLines(cartId)
      const code = await run([
        this.keys.hold(cartId),
        this.keys.expiry(),
        ...lines.flatMap((line) => [line.avail_key, this.keys.heldFromAvail(line.avail_key)]),
      ])
      if (code !== -4) {
        return code
      }
      await backoff(attempt)
    }
    throw new Error(`hot-stock: hold of ${cartId} kept changing, gave up after ${MAX_ATTEMPTS} attempts`)
  }

  __hooks = {
    // Đóng kết nối khi Medusa tắt, để tiến trình (và jest) thoát gọn.
    onApplicationShutdown: async () => {
      await this.redis.quit().catch(() => this.redis.disconnect())
    },
  }
}
