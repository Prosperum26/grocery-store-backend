import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { fromVnpAmount } from "./lib/amount"
import { readOriginalPayment } from "./lib/original-payment"
import { requestVnpayRefund } from "./lib/refund-client"
import { verifyParams } from "./lib/signature"
import { buildTxnRef, parseTxnRef } from "./lib/txn-ref"
import { buildPaymentUrl } from "./lib/url"

export type VnpayOptions = {
  tmnCode: string
  hashSecret: string
  payUrl: string
  returnUrl: string
  /** vnp_IpAddr; mặc định 127.0.0.1 (sandbox). */
  ipAddr?: string
  /** URL API hoàn tiền (merchant_webapi); mặc định URL sandbox. */
  apiUrl?: string
}

// Phiên VNPAY được coi là đã trả khi IPN hợp lệ đã đánh dấu `data.paid` (route hooks/vnpay/ipn).
// Dấu này là thứ duy nhất cho phép authorizePayment trả "authorized": storefront cũng gọi
// authorizePayment khi `complete` giỏ, nên không có nó thì ai có id giỏ cũng lấy được đơn chưa trả tiền.
const isPaid = (data?: Record<string, unknown>) => data?.paid === true

// vnp_CreateBy của yêu cầu hoàn: hệ thống tự hoàn khi khách huỷ đơn, không có tên người dùng.
const REFUND_CREATED_BY = "Com4Fud"

class VnpayProviderService extends AbstractPaymentProvider<VnpayOptions> {
  static identifier = "vnpay"

  static validateOptions(options: Record<any, any>): void | never {
    for (const key of ["tmnCode", "hashSecret"]) {
      if (!options?.[key]) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `VNPAY option "${key}" is required`)
      }
    }
  }

  protected options_: VnpayOptions

  constructor(container: Record<string, unknown>, options: VnpayOptions) {
    super(container, options)
    this.options_ = options
  }

  // Tạo mã giao dịch + link thanh toán cho một lần thử của phiên.
  private startAttempt_(sessionId: string, attempt: number, amount: InitiatePaymentInput["amount"]) {
    const txnRef = buildTxnRef(sessionId, attempt)
    const paymentUrl = buildPaymentUrl(
      this.options_,
      { txnRef, amountVnd: new BigNumber(amount).numeric },
      new Date()
    )
    return {
      id: txnRef,
      data: { txn_ref: txnRef, attempt, payment_url: paymentUrl, status: "pending" },
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    // Payment module truyền id phiên (payses_...) qua context.idempotency_key.
    const sessionId = input.context?.idempotency_key
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "VNPAY initiatePayment needs the payment session id")
    }
    return this.startAttempt_(sessionId, Number(input.data?.attempt ?? 0) + 1, input.amount)
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Đã trả: giữ nguyên (IPN dùng đường này để ghi dấu paid).
    if (isPaid(input.data)) {
      return { data: input.data }
    }
    // Chưa trả mà số tiền đổi: VNPAY không cho dùng lại mã giao dịch, nên tạo lần thử mới.
    const previous = parseTxnRef(String(input.data?.txn_ref))
    return this.startAttempt_(previous.sessionId, previous.attempt + 1, input.amount)
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return {
      status: isPaid(input.data) ? PaymentSessionStatus.AUTHORIZED : PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  // VNPAY đã thu tiền khi khách trả; không có thao tác capture riêng.
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    return {
      status: isPaid(input.data) ? PaymentSessionStatus.AUTHORIZED : PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  // Hoàn tiền qua API refund của VNPAY. Mọi thất bại đều thành MedusaError (D4) để workflow gọi tới
  // (cancelOrderWorkflow) dừng và bù trừ, không để đơn bị huỷ mà tiền chưa hoàn.
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = input.data ?? {}
    const original = readOriginalPayment(data)

    let result
    try {
      result = await requestVnpayRefund(this.options_, {
        txnRef: original.txnRef,
        amountVnd: new BigNumber(input.amount).numeric,
        originalAmountVnd: original.amountVnd,
        transactionDate: original.createDate,
        transactionNo: typeof data.vnp_transaction_no === "string" ? data.vnp_transaction_no : undefined,
        orderInfo: `Hoan tien ${original.txnRef}`,
        createBy: REFUND_CREATED_BY,
      })
    } catch (e) {
      if (MedusaError.isMedusaError(e)) {
        throw e
      }
      // Lỗi mạng: không biết VNPAY đã nhận yêu cầu hay chưa.
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `VNPAY refund request failed: ${(e as Error).message}`)
    }

    if (!result.ok) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `VNPAY refund rejected (code ${result.code}): ${result.message ?? "no message"}`
      )
    }
    return { data: { ...data, vnp_refund_transaction_no: result.transactionNo } }
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const query = payload.data

    if (!verifyParams(query, this.options_.hashSecret)) {
      return { action: "not_supported" }
    }

    let sessionId: string
    let amount: BigNumber
    try {
      sessionId = parseTxnRef(String(query.vnp_TxnRef)).sessionId
      amount = new BigNumber(fromVnpAmount(Number(query.vnp_Amount)))
    } catch {
      return { action: "not_supported" }
    }

    const succeeded = query.vnp_ResponseCode === "00" && query.vnp_TransactionStatus === "00"
    return { action: succeeded ? "captured" : "failed", data: { session_id: sessionId, amount } }
  }
}

export default VnpayProviderService
