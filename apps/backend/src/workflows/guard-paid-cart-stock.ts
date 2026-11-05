import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"
import { vnpayOptionsFromEnv } from "../modules/vnpay/lib/options"
import { readOriginalPayment } from "../modules/vnpay/lib/original-payment"
import { requestVnpayRefund } from "../modules/vnpay/lib/refund-client"
import { reserveCartStockWorkflow, type ReserveCartStockResult, type StockShortage } from "./reserve-cart-stock"

/** Ghi vào `cart.metadata.stock_failed` khi khách đã trả tiền nhưng hết hàng (plan hot-stock D4). */
export type StockFailed = {
  at: string
  /** vnp_TxnRef của giao dịch đã hoàn: IPN lặp của đúng giao dịch này trả 02, giao dịch mới thì xử lý lại (RB-1). */
  txn_ref: string
  items: StockShortage[]
  vnp_transaction_no?: string
  /** refunded: VNPAY đã nhận lệnh hoàn · failed: hoàn lỗi, Admin xử lý tay (rủi ro R4). */
  refund: "refunded" | "failed"
  refund_error?: string
}

export type GuardPaidCartInput = {
  cart_id: string
  /** vnp_TxnRef của IPN đang xử lý. */
  txn_ref: string
  session: { amount: unknown; data: Record<string, unknown> }
  vnp_transaction_no?: string
}

/** hold_ok: hold còn HELD · reheld: hold đã hết, giữ lại được · already_failed: IPN gửi lại của giao dịch đã hoàn · out_of_stock: đã hoàn tiền */
export type GuardPaidCartResult = { status: "hold_ok" | "reheld" | "already_failed" } | { status: "out_of_stock"; stock_failed: StockFailed }

type CartForGuard = { id: string; metadata: Record<string, unknown> | null }

// Hold còn HELD (hoặc đã CONFIRMED) thì đi tiếp; IPN lặp lại của đúng giao dịch đã hoàn thì dừng.
// Chỉ so theo giao dịch, không theo giỏ: khách bị hoàn rồi thanh toán lại trên cùng giỏ (phiên VNPAY mới,
// txn_ref mới) phải được xử lý như bình thường, nếu không tiền lần hai bị thu mà không có đơn (RB-1).
const checkPaidCartHoldStep = createStep("check-paid-cart-hold", async (input: { cart: CartForGuard; txn_ref: string }, { container }) => {
  const { cart } = input
  const failed = cart.metadata?.stock_failed as Partial<StockFailed> | undefined
  if (failed?.txn_ref === input.txn_ref) {
    return new StepResponse("already_failed" as const)
  }
  const hold = await container.resolve<HotStockModuleService>(HOT_STOCK_MODULE).getHold(cart.id)
  return new StepResponse(hold?.status === "HELD" || hold?.status === "CONFIRMED" ? ("hold_ok" as const) : ("needs_rehold" as const))
})

/**
 * Hoàn tiền cho khách đã trả nhưng hết hàng, rồi ghi `stock_failed` vào giỏ. Phải tự hoàn: lúc này chưa có
 * payment trong Medusa và Postgres vẫn còn hàng (món đang được giỏ khác giữ trong Redis), nên compensation
 * của Medusa không chạy (verified-apis HS-0). Không có compensation: lệnh hoàn đã gửi thì không thu hồi được.
 */
const refundOutOfStockStep = createStep(
  "refund-out-of-stock-payment",
  async (input: { cart: CartForGuard; session: GuardPaidCartInput["session"]; items: StockShortage[]; txn_ref: string; vnp_transaction_no?: string }, { container }) => {
    // Ghi đè stock_failed của lần trước (nếu có): giỏ chỉ giữ kết quả của lần thanh toán gần nhất.
    const stockFailed: StockFailed = { at: new Date().toISOString(), txn_ref: input.txn_ref, items: input.items, vnp_transaction_no: input.vnp_transaction_no, refund: "failed" }
    try {
      const original = readOriginalPayment(input.session.data)
      const result = await requestVnpayRefund(vnpayOptionsFromEnv(), {
        txnRef: original.txnRef,
        amountVnd: Number(input.session.amount),
        originalAmountVnd: original.amountVnd,
        transactionDate: original.createDate,
        transactionNo: input.vnp_transaction_no,
        orderInfo: `Hoan tien het hang ${original.txnRef}`,
        createBy: "Com4Fud",
      })
      if (result.ok) {
        stockFailed.refund = "refunded"
      } else {
        stockFailed.refund_error = `VNPAY code ${result.code}${result.message ? `: ${result.message}` : ""}`
      }
    } catch (e) {
      // Lỗi mạng hoặc dữ liệu phiên thiếu: không biết VNPAY đã hoàn chưa, để Admin kiểm tra tay.
      stockFailed.refund_error = (e as Error).message
    }
    if (stockFailed.refund === "failed") {
      container.resolve(ContainerRegistrationKeys.LOGGER).error(`hot-stock: refund for out-of-stock cart ${input.cart.id} failed: ${stockFailed.refund_error}`)
    }
    await container.resolve(Modules.CART).updateCarts([{ id: input.cart.id, metadata: { ...(input.cart.metadata ?? {}), stock_failed: stockFailed } }])
    return new StepResponse(stockFailed)
  }
)

/**
 * Lưới an toàn khi VNPAY báo đã trả tiền (plan hot-stock D4, HS-6), chạy trong IPN **trước** khi đánh dấu
 * phiên đã trả và cho Medusa hoàn tất giỏ:
 * - hold còn HELD: đi tiếp
 * - hold đã hết hạn, đã trả hoặc khách chưa từng giữ: giữ lại ngay; còn hàng thì đi tiếp
 * - không còn hàng (giỏ khác đã giữ mất trong lúc chờ IPN): hoàn tiền, không tạo đơn
 * Khoá theo giỏ: hai IPN đến cùng lúc không hoàn tiền hai lần.
 */
export const guardPaidCartStockWorkflow = createWorkflow("guard-paid-cart-stock", (input: GuardPaidCartInput) => {
  const lockKey = transform({ input }, ({ input }) => `hot-stock-ipn-${input.cart_id}`)
  acquireLockStep({ key: lockKey, timeout: 30, ttl: 120 })

  const { data: carts } = useQueryGraphStep({
    entity: "cart",
    fields: ["id", "metadata"],
    filters: { id: input.cart_id },
    options: { throwIfKeyNotFound: true },
  })
  const cart = transform({ carts }, ({ carts }) => carts[0] as CartForGuard)
  const check = checkPaidCartHoldStep(transform({ cart, input }, ({ cart, input }) => ({ cart, txn_ref: input.txn_ref })))

  const rehold = when({ check }, ({ check }) => check === "needs_rehold").then(() =>
    reserveCartStockWorkflow.runAsStep({ input: { cart_id: input.cart_id } })
  )

  const stockFailed = when({ check, rehold }, ({ check, rehold }) => check === "needs_rehold" && rehold?.status === "out_of_stock").then(() =>
    refundOutOfStockStep(
      transform({ cart, input, rehold }, ({ cart, input, rehold }) => ({
        cart,
        session: input.session,
        items: (rehold as Extract<ReserveCartStockResult, { status: "out_of_stock" }>).items,
        txn_ref: input.txn_ref,
        vnp_transaction_no: input.vnp_transaction_no,
      }))
    )
  )

  releaseLockStep({ key: lockKey })

  const result = transform({ check, stockFailed }, ({ check, stockFailed }): GuardPaidCartResult => {
    if (stockFailed) {
      return { status: "out_of_stock", stock_failed: stockFailed }
    }
    if (check === "needs_rehold") {
      return { status: "reheld" }
    }
    return { status: check }
  })
  return new WorkflowResponse(result)
})
