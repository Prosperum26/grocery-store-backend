import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  cancelOrderWorkflow,
  refundPaymentsWorkflow,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"

export type CustomerCancelOrderInput = { order_id: string; customer_id: string }

// Mã lỗi của route (API-6). MedusaError CONFLICT bị error handler của Medusa ghi đè `code`, nên route
// tự bắt lỗi mang mã này và trả 409 (verified-apis BE-4).
export const ORDER_NOT_CANCELLABLE = "ORDER_NOT_CANCELLABLE"
export const REFUND_FAILED = "REFUND_FAILED"

const ORDER_PAYMENT_FIELDS = [
  "id",
  "payment_collections.payments.id",
  "payment_collections.payments.captures.amount",
  "payment_collections.payments.refunds.amount",
]

type PaymentForRefund = {
  id: string
  captures?: { amount: unknown }[]
  refunds?: { amount: unknown }[]
}

type OrderForCancel = {
  status: string
  metadata: Record<string, any> | null
  fulfillments?: { canceled_at?: string | null }[]
  payment_collections?: { payments?: PaymentForRefund[] }[]
}

const sumAmounts = (rows?: { amount: unknown }[]) => (rows ?? []).reduce((total, row) => total + Number(row.amount), 0)

// Số tiền còn phải hoàn của mỗi payment = đã capture trừ đã hoàn (VND là số nguyên đồng).
const refundableOf = (order: Pick<OrderForCancel, "payment_collections">) =>
  (order.payment_collections ?? [])
    .flatMap((collection) => collection.payments ?? [])
    .map((payment) => ({ payment_id: payment.id, amount: sumAmounts(payment.captures) - sumAmounts(payment.refunds) }))
    .filter((payment) => payment.amount > 0)

// Khách chỉ được huỷ khi đơn còn "Chờ xác nhận". Kiểm cả fulfillment vì stage có thể chậm hơn sự kiện
// (subscriber chạy bất đồng bộ); cancelOrderWorkflow cũng từ chối khi còn fulfillment chưa huỷ nhưng
// bằng NOT_ALLOWED (400), còn ở đây cần 409 cùng mã với các trường hợp khác.
const validateCancellableStep = createStep("validate-cancellable", async (order: OrderForCancel) => {
  const stage = order.metadata?.stage
  if (stage !== "PENDING") {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Order is in stage ${stage ?? "none"}, only PENDING orders can be canceled`,
      ORDER_NOT_CANCELLABLE
    )
  }
  if (order.status === "canceled") {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Order is already canceled", ORDER_NOT_CANCELLABLE)
  }
  if ((order.fulfillments ?? []).some((fulfillment) => !fulfillment.canceled_at)) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Order has a fulfillment that is not canceled",
      ORDER_NOT_CANCELLABLE
    )
  }
})

// Phần cần hoàn của đơn, dựng input cho refundPaymentsWorkflow.
const planRefundsStep = createStep("plan-refunds", async (input: { order: OrderForCancel; created_by: string }) => {
  return new StepResponse(
    refundableOf(input.order).map((payment) => ({ ...payment, created_by: input.created_by }))
  )
})

// Medusa 2.21.1: refundPaymentsStep NUỐT lỗi của provider (chỉ ghi log "Error was thrown trying to cancel
// payment"), nên cancelOrderWorkflow vẫn huỷ đơn dù hoàn tiền thất bại. Vì vậy ta hoàn tiền trước, rồi
// đọc lại dữ liệu: payment nào đã capture mà còn chưa hoàn hết thì dừng, đơn chưa bị huỷ.
const assertRefundedStep = createStep("assert-refunded", async (input: { order_id: string }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_PAYMENT_FIELDS,
    filters: { id: input.order_id },
  })
  const unrefunded = refundableOf(data[0] as OrderForCancel)
  if (unrefunded.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Refund did not complete for ${unrefunded.map((payment) => payment.payment_id).join(", ")}, order was not canceled`,
      REFUND_FAILED
    )
  }
})

/**
 * Khách tự huỷ đơn của mình khi `stage = PENDING` (BE-8). Thứ tự: tìm đơn theo (id, customer_id) rồi kiểm
 * stage, hoàn tiền payment đã capture (gọi refundPayment của provider) và kiểm lại đã hoàn đủ, rồi chạy
 * cancelOrderWorkflow của Medusa: xoá reservation để trả tồn kho, phát order.canceled. Subscriber BE-6 nhận
 * event đó để đặt stage CANCELLED, nên stage không được đặt ở đây.
 * Đơn không tồn tại hoặc của khách khác: NOT_FOUND (404, không lộ việc đơn có tồn tại).
 * Hoàn tiền lỗi: ném REFUND_FAILED trước khi huỷ, đơn giữ nguyên. Hoàn đã thành công mà bước sau lỗi thì
 * gọi lại là an toàn: phần còn phải hoàn đã bằng 0 nên không hoàn hai lần.
 */
export const customerCancelOrderWorkflow = createWorkflow(
  "customer-cancel-order",
  (input: CustomerCancelOrderInput) => {
    // Cùng khoá với setOrderStageWorkflow: kiểm stage và huỷ không xen vào giữa lúc Admin xác nhận đơn.
    const lockKey = transform({ input }, ({ input }) => `order-stage-${input.order_id}`)
    acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })

    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "status",
        "metadata",
        "fulfillments.canceled_at",
        "payment_collections.payments.id",
        "payment_collections.payments.captures.amount",
        "payment_collections.payments.refunds.amount",
      ],
      filters: { id: input.order_id, customer_id: input.customer_id },
      options: { throwIfKeyNotFound: true },
    })

    const order = transform({ orders }, ({ orders }) => orders[0] as OrderForCancel)
    validateCancellableStep(order)

    const refunds = planRefundsStep(transform({ order, input }, ({ order, input }) => ({ order, created_by: input.customer_id })))
    when({ refunds }, ({ refunds }) => refunds.length > 0).then(() => {
      refundPaymentsWorkflow.runAsStep({ input: refunds })
    })
    assertRefundedStep(transform({ input }, ({ input }) => ({ order_id: input.order_id })))

    cancelOrderWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({ order_id: input.order_id, canceled_by: input.customer_id })),
    })

    releaseLockStep({ key: lockKey })
    return new WorkflowResponse({ id: input.order_id })
  }
)
