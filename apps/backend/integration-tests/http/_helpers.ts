// Chờ cho tới khi fn trả giá trị "thật" (khác undefined/false); dùng cho subscriber/event bất đồng bộ.
export async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 5000, intervalMs = 100 } = opts
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value !== undefined && value !== false) {
      return value
    }
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: hết ${timeoutMs}ms mà điều kiện chưa thỏa`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
