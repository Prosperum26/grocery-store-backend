import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { findStuckPaymentsWorkflow } from "../workflows/find-stuck-payments"
import { syncHotStockWorkflow } from "../workflows/sync-hot-stock"

/**
 * Đối soát Redis với Postgres mỗi 15 phút (rủi ro TR-01): bắt các thay đổi không phát event, hoặc event
 * bị mất khi server tắt giữa chừng. Ghi log số món bị lệch làm bằng chứng cho báo cáo. Kiểm thêm payment bị kẹt (R2).
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

  // Rủi ro R2: tiền đã thu mà không có đơn và chưa hoàn (Medusa hoàn lỗi chỉ ghi log). Đánh dấu giỏ cho Admin.
  const { result: stuck } = await findStuckPaymentsWorkflow(container).run({ input: {} })
  if (stuck.marked.length) {
    logger.warn(`payment check: ${stuck.marked.length} carts paid without order or refund: ${stuck.marked.join(", ")}`)
  }
  return { ...result, stuck_carts: stuck.marked }
}

export const config = {
  name: "reconcile-hot-stock",
  schedule: "*/15 * * * *",
}
