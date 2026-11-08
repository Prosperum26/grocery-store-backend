import type { ExecArgs } from "@medusajs/framework/types"
import { syncHotStockWorkflow } from "../workflows/sync-hot-stock"

// Dựng lại toàn bộ key tồn kho trong Redis từ Postgres (sau khi xoá Redis, hoặc khi nghi bị lệch):
// cd apps/backend && npx medusa exec ./src/scripts/rebuild-hot-stock.ts
export default async function rebuildHotStock({ container }: ExecArgs) {
  const { result } = await syncHotStockWorkflow(container).run({ input: {} })
  console.log(`Hot-stock: ${result.synced} items synced (${result.created} new, ${result.changed} corrected)`)
}
