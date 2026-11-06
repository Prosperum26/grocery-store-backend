import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"
import { syncHotStockWorkflow } from "./sync-hot-stock"

type OrderForConfirm = {
  id: string
  cart?: { id: string } | null
  items?: { variant?: { inventory_items?: { inventory_item_id: string }[] | null } | null }[] | null
}

// Hold của giỏ thành CONFIRMED: từ giờ Medusa giữ phần đó bằng reservation của đơn.
// Không có compensation: xác nhận là bước cuối, và hold CONFIRMED không được trả về kho.
const confirmCartHoldStep = createStep("confirm-cart-hold", async (order: OrderForConfirm, { container }) => {
  const cartId = order.cart?.id
  if (!cartId) {
    return new StepResponse("no_cart" as const)
  }
  return new StepResponse(await container.resolve<HotStockModuleService>(HOT_STOCK_MODULE).confirm(cartId))
})

/**
 * Đơn vừa đặt (order.placed) → xác nhận hold của giỏ (plan hot-stock HS-5). Event mang **order id**, nên
 * tra cart qua link order_cart (repo thử issue #9 lấy nhầm order id làm cart id, hold không bao giờ được
 * xác nhận và hàng bị trả về sau 15 phút). Sau đó đặt lại các món của đơn từ Postgres: trong khoảng giữa lúc
 * Medusa tạo reservation và lúc xác nhận, món bị tính hai lần (cả reserved lẫn held), bước này đưa về đúng.
 * Giỏ chưa giữ hàng (khách bỏ qua API-14) thì `not_held`, vẫn đặt lại bình thường.
 */
export const confirmCartHoldWorkflow = createWorkflow("confirm-cart-hold", (input: { order_id: string }) => {
  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: ["id", "cart.id", "items.variant.inventory_items.inventory_item_id"],
    filters: { id: input.order_id },
    options: { throwIfKeyNotFound: true },
  })
  const order = transform({ orders }, ({ orders }) => orders[0] as OrderForConfirm)
  const status = confirmCartHoldStep(order)

  const itemIds = transform({ order }, ({ order }) => [
    ...new Set((order.items ?? []).flatMap((item) => (item.variant?.inventory_items ?? []).map((link) => link.inventory_item_id))),
  ])
  syncHotStockWorkflow.runAsStep({ input: { inventory_item_ids: itemIds } })

  return new WorkflowResponse(status)
})
