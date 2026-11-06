import { Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"

/** Ghi vào `cart.metadata.payment_stuck`: tiền đã thu, không có đơn, chưa hoàn (rủi ro R2). */
export type PaymentStuck = { payment_id: string; amount: number; captured_at: string; detected_at: string }

type PaymentRow = {
  id: string
  amount: unknown
  captured_at: string | null
  canceled_at: string | null
  payment_collection_id: string
  refunds?: { id: string }[] | null
}

// Đánh dấu giỏ của các payment bị kẹt. Không có compensation: chỉ ghi metadata, chạy lại không ghi đè dấu cũ.
const markStuckCartsStep = createStep(
  "mark-stuck-payment-carts",
  async (input: { payments: PaymentRow[]; withOrder: string[]; carts: { cart_id: string; payment_collection_id: string }[]; minAgeSeconds: number }, { container }) => {
    const query = container.resolve("query")
    const cutoff = Date.now() - input.minAgeSeconds * 1000
    const withOrder = new Set(input.withOrder)
    const stuck = input.payments.filter(
      (payment) =>
        payment.captured_at &&
        !payment.canceled_at &&
        !payment.refunds?.length &&
        !withOrder.has(payment.payment_collection_id) &&
        // Medusa thu tiền trước rồi mới tạo đơn: chờ một lúc để không bắt nhầm đơn đang được tạo.
        new Date(payment.captured_at).getTime() <= cutoff
    )
    const cartOf = new Map(input.carts.map((link) => [link.payment_collection_id, link.cart_id]))
    const marked: string[] = []
    for (const payment of stuck) {
      const cartId = cartOf.get(payment.payment_collection_id)
      if (!cartId) continue
      const { data } = await query.graph({ entity: "cart", fields: ["id", "metadata"], filters: { id: cartId } })
      const metadata = (data[0]?.metadata ?? {}) as Record<string, unknown>
      if (metadata.payment_stuck) continue
      const mark: PaymentStuck = {
        payment_id: payment.id,
        amount: Number(payment.amount),
        captured_at: payment.captured_at!,
        detected_at: new Date().toISOString(),
      }
      await container.resolve(Modules.CART).updateCarts([{ id: cartId, metadata: { ...metadata, payment_stuck: mark } }])
      marked.push(cartId)
    }
    return new StepResponse({ stuck: stuck.length, marked })
  }
)

/**
 * Tìm payment đã thu tiền mà không có đơn và chưa hoàn (rủi ro R2, plan hot-stock HS-6): hoàn tất giỏ lỗi sau
 * khi thu tiền thì Medusa tự hoàn, nhưng hoàn lỗi chỉ được ghi log (verified-apis HS-0). Job đối soát chạy
 * workflow này và đánh dấu `cart.metadata.payment_stuck` để Admin xử lý tay.
 */
export const findStuckPaymentsWorkflow = createWorkflow("find-stuck-payments", (input: { min_age_seconds?: number }) => {
  const { data: payments } = useQueryGraphStep({
    entity: "payment",
    fields: ["id", "amount", "captured_at", "canceled_at", "payment_collection_id", "refunds.id"],
    filters: { captured_at: { $ne: null } },
  }).config({ name: "get-captured-payments" })

  const collectionIds = transform({ payments }, ({ payments }) => [...new Set((payments as PaymentRow[]).map((p) => p.payment_collection_id))])

  const { data: orderLinks } = useQueryGraphStep({
    entity: "order_payment_collection",
    fields: ["payment_collection_id"],
    filters: { payment_collection_id: collectionIds },
  }).config({ name: "get-collections-with-order" })

  const { data: cartLinks } = useQueryGraphStep({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { payment_collection_id: collectionIds },
  }).config({ name: "get-collection-carts" })

  const result = markStuckCartsStep(
    transform({ payments, orderLinks, cartLinks, input }, ({ payments, orderLinks, cartLinks, input }) => ({
      payments: payments as PaymentRow[],
      withOrder: (orderLinks as { payment_collection_id: string }[]).map((link) => link.payment_collection_id),
      carts: cartLinks as { cart_id: string; payment_collection_id: string }[],
      minAgeSeconds: input.min_age_seconds ?? 600,
    }))
  )
  return new WorkflowResponse(result)
})
