import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { setOrderStageWorkflow } from "../../workflows/set-order-stage"
import { resolveOrderId } from "./resolve-order"
import type { OrderStage } from "./stages"

/**
 * Đặt stage cho đơn từ một subscriber. Event có thể đến lặp hoặc lệch thứ tự, khi đó bước chuyển bị
 * từ chối bằng INVALID_DATA: chỉ log cảnh báo để event không bị coi là lỗi và thử lại mãi.
 */
export async function applyOrderStage(
  container: MedusaContainer,
  orderId: string | undefined,
  stage: OrderStage,
  by: string
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!orderId) {
    logger.warn(`order-stage: ${by} -> ${stage} skipped, order not found`)
    return
  }
  try {
    await setOrderStageWorkflow(container).run({ input: { order_id: orderId, stage, by } })
  } catch (e) {
    if (MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA) {
      logger.warn(`order-stage: ${by} ignored for ${orderId}: ${e.message}`)
      return
    }
    throw e
  }
}

/** Event của fulfillment (shipment.created, delivery.created) mang id fulfillment: tra ra đơn rồi đặt stage. */
export async function applyOrderStageByFulfillment(
  container: MedusaContainer,
  fulfillmentId: string,
  stage: OrderStage,
  by: string
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  await applyOrderStage(container, await resolveOrderId.fromFulfillment(query, fulfillmentId), stage, by)
}
