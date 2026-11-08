import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { stockEventTarget } from "../lib/inventory/stock-event"
import { syncHotStockWorkflow } from "../workflows/sync-hot-stock"

/**
 * Tồn kho trong Postgres đổi thì đặt lại món đó trong Redis:
 * - inventory-level.*: admin nhập/sửa tồn, thêm hoặc xoá kho của món
 * - reservation-item.*: hoàn tất giỏ tạo reservation, huỷ đơn xoá reservation (hoàn tất giỏ KHÔNG phát
 *   inventory-level.updated dù reserved_quantity tăng, verified-apis HS-0)
 */
export default async function hotStockSync({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const target = await stockEventTarget(query, event.name, event.data.id)
  if (!target) {
    container.resolve(ContainerRegistrationKeys.LOGGER).warn(`hot-stock: ${event.name} ${event.data.id} not found, rebuilding all stock keys`)
  }
  // Không tìm thấy bản ghi thì đặt lại toàn bộ (vài giây với catalog 2.129 món).
  await syncHotStockWorkflow(container).run({ input: target ?? {} })
}

export const config: SubscriberConfig = {
  event: [
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-level.deleted",
    "reservation-item.created",
    "reservation-item.updated",
    "reservation-item.deleted",
  ],
}
