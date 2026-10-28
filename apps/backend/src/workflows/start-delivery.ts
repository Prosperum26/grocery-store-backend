import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  createOrderShipmentWorkflow,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { estimateDelivery } from "../lib/delivery/estimate"

export type StartDeliveryInput = { order_id: string }

// Hình dạng `metadata.delivery` (API-7). Chưa có tên tài xế và biển số vì Admin chỉ bấm một nút.
export type OrderDelivery = {
  distance_km: number
  eta_at: string
  started_at: string
  notice_sent_at: string
}

type OrderForDelivery = {
  metadata: Record<string, any> | null
  shipping_address?: Record<string, any> | null
  fulfillments?: {
    id: string
    shipped_at?: string | null
    canceled_at?: string | null
    items?: { line_item_id: string; quantity: unknown }[]
  }[]
}

// Kiểm tra đơn được phép bắt đầu giao, chọn fulfillment cần giao rồi tính ETA. Chưa ghi gì.
// Đơn không ở PREPARING hoặc không còn fulfillment nào chưa giao thì ném CONFLICT (409).
const planDeliveryStep = createStep("plan-delivery",async (order: OrderForDelivery) => {
  const stage = order.metadata?.stage
  if (stage !== "PREPARING") {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Order is in stage ${stage ?? "none"}, delivery can only start from PREPARING`
    )
  }

  // Bấm hai lần liên tiếp: lần hai không còn fulfillment nào chưa giao, dù stage chưa kịp đổi (subscriber chạy bất đồng bộ).
  const fulfillment = (order.fulfillments ?? []).find((f) => !f.shipped_at && !f.canceled_at)
  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Order has no unshipped fulfillment")
  }

  // Quận có thể nằm ở bất kỳ ô nào của địa chỉ giao, nên ghép lại rồi để estimateDelivery tự tìm.
  const address = order.shipping_address
  const addressText = [address?.address_1, address?.address_2, address?.city, address?.province]
    .filter(Boolean)
    .join(", ")

  const startedAt = new Date()
  const { distanceKm, etaAt } = estimateDelivery(addressText, startedAt)
  const delivery: OrderDelivery = {
    distance_km: distanceKm,
    eta_at: etaAt.toISOString(),
    started_at: startedAt.toISOString(),
    // O2: không gửi thông báo đẩy thật; ghi mốc này để storefront hiện băng thông báo khi khách mở đơn.
    notice_sent_at: startedAt.toISOString(),
  }

  return new StepResponse({
    fulfillment_id: fulfillment.id,
    // Giao đúng các dòng hàng của fulfillment này (S7: items = [{ id: id dòng hàng, quantity }]).
    items: (fulfillment.items ?? []).map((item) => ({ id: item.line_item_id, quantity: Number(item.quantity) })),
    delivery,
  })
})

async function readMetadata(container: any, orderId: string): Promise<Record<string, any>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "metadata"], filters: { id: orderId } })
  return (data[0]?.metadata ?? {}) as Record<string, any>
}

// Ghi metadata.delivery, giữ nguyên các khoá khác. Compensation khôi phục đúng giá trị cũ của khoá `delivery`
// (hoặc xoá khoá nếu trước đó chưa có); đọc lại metadata hiện tại để không đè `stage` nếu đã đổi trong lúc chờ.
const setDeliveryMetadataStep = createStep(
  "set-delivery-metadata",
  async (input: { order_id: string; delivery: OrderDelivery }, { container }) => {
    const metadata = await readMetadata(container, input.order_id)
    await container
      .resolve(Modules.ORDER)
      .updateOrders(input.order_id, { metadata: { ...metadata, delivery: input.delivery } })
    return new StepResponse(input.delivery, {
      order_id: input.order_id,
      had_delivery: "delivery" in metadata,
      previous: metadata.delivery,
    })
  },
  async (rollback, { container }) => {
    if (!rollback) {
      return
    }
    const { delivery: _current, ...rest } = await readMetadata(container, rollback.order_id)
    await container
      .resolve(Modules.ORDER)
      .updateOrders(rollback.order_id, {
        metadata: rollback.had_delivery ? { ...rest, delivery: rollback.previous } : rest,
      })
  }
)

/**
 * Admin bấm "Bắt đầu giao" trên đơn PREPARING: ghi `metadata.delivery` (ETA theo quận), rồi tạo shipment
 * bằng workflow lõi của Medusa. `stage` sang SHIPPING do subscriber `shipment.created` (BE-6) đặt, không đặt ở đây.
 * Tạo shipment lỗi thì step ghi metadata được bù trừ, đơn trở lại như cũ.
 */
export const startDeliveryWorkflow = createWorkflow("start-delivery", (input: StartDeliveryInput) => {
  // Khoá theo đơn để hai lần bấm đồng thời không cùng đi qua bước kiểm tra.
  const lockKey = transform({ input }, ({ input }) => `start-delivery-${input.order_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })

  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "shipping_address.*",
      "fulfillments.id",
      "fulfillments.shipped_at",
      "fulfillments.canceled_at",
      "fulfillments.items.line_item_id",
      "fulfillments.items.quantity",
    ],
    filters: { id: input.order_id },
    options: { throwIfKeyNotFound: true },
  })

  const plan = planDeliveryStep(transform({ orders }, ({ orders }) => orders[0] as OrderForDelivery))

  const delivery = setDeliveryMetadataStep(
    transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, delivery: plan.delivery }))
  )

  createOrderShipmentWorkflow.runAsStep({
    input: transform({ input, plan }, ({ input, plan }) => ({
      order_id: input.order_id,
      fulfillment_id: plan.fulfillment_id,
      items: plan.items,
    })),
  })

  releaseLockStep({ key: lockKey })
  return new WorkflowResponse(delivery)
})
