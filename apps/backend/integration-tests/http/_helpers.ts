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

// Trong test runner, index tìm kiếm chỉ dùng được khi có "active version" (verified-apis S1).
// Chạy tay migration plan + seed plan rồi thăm dò /store/search tới khi 200.
// Gọi TRƯỚC khi seed sản phẩm để các sự kiện product.* được nạp thẳng vào index.
export async function waitForSearchReady(
  container: { resolve: (key: string) => any },
  probe: () => Promise<number>
): Promise<void> {
  const searchModule = container.resolve("search")
  const migration = await searchModule.createIndexMigrationPlan()
  await searchModule.executeIndexMigrationPlan(migration)
  const seed = await searchModule.createSeedPlan_()
  await searchModule.executeSeedPlan_(seed)
  await waitFor(async () => ((await probe()) === 200 ? true : undefined), { timeoutMs: 30000, intervalMs: 500 })
}
