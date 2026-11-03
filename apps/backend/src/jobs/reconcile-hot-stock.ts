import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncHotStockWorkflow } from "../workflows/sync-hot-stock"

/**
 * Đối soát Redis với Postgres mỗi 15 phút (rủi ro TR-01): bắt các thay đổi không phát event, hoặc event
 * bị mất khi server tắt giữa chừng. Ghi log số món bị lệch làm bằng chứng cho báo cáo.
 */
export default async function reconcileHotStock(container: MedusaContainer) {
  const { result } = await syncHotStockWorkflow(container).run({ input: {} })
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const message = `hot-stock reconcile: ${result.synced} items, ${result.changed} drifted, ${result.created} missing`
  if (result.changed || result.created) {
    logger.warn(message)
  } else {
    logger.info(message)
  }
  return result
}

export const config = {
  name: "reconcile-hot-stock",
  schedule: "*/15 * * * *",
}
