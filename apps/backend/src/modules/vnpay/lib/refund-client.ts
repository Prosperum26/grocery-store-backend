import { createHmac, randomUUID } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"
import { toVnpAmount } from "./amount"
import { formatVnpDate } from "./url"

// API hoàn tiền (vnp_Command=refund), xem verified-apis.md mục BE-8.
export const DEFAULT_REFUND_API_URL = "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"

export type RefundOptions = {
  tmnCode: string
  hashSecret: string
  /** Mặc định là URL sandbox. */
  apiUrl?: string
  ipAddr?: string
}

export type RefundRequest = {
  /** vnp_TxnRef của lần thanh toán gốc. */
  txnRef: string
  amountVnd: number
  /** Số tiền của giao dịch gốc: nhỏ hơn thì là hoàn một phần (03), bằng thì hoàn toàn phần (02). */
  originalAmountVnd: number
  /** vnp_CreateDate của request `pay` gốc, dạng yyyyMMddHHmmss giờ VN. */
  transactionDate: string
  /** vnp_TransactionNo của lần thanh toán gốc (tuỳ chọn). */
  transactionNo?: string
  orderInfo: string
  createBy: string
}

export type RefundResult =
  | { ok: true; transactionNo?: string }
  | { ok: false; code: string; message?: string }

// `fetch`, `now`, `requestId` truyền vào để test cố định kết quả.
type Deps = { fetch?: typeof fetch; now?: Date; requestId?: string }

/**
 * Gọi API hoàn tiền của VNPAY.
 * - VNPAY trả mã lỗi (91, 94, 95, 97...) -> { ok: false, code }: yêu cầu đã tới nơi và bị từ chối.
 * - Lỗi mạng, HTTP không 2xx, body không phải JSON -> ném lỗi: không biết VNPAY đã hoàn hay chưa,
 *   nên nơi gọi không được coi là "đã từ chối" rồi thử lại tự động.
 */
export async function requestVnpayRefund(
  options: RefundOptions,
  request: RefundRequest,
  deps: Deps = {}
): Promise<RefundResult> {
  const { amountVnd, originalAmountVnd } = request
  if (!Number.isInteger(amountVnd) || amountVnd <= 0 || amountVnd > originalAmountVnd) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `VNPAY refund amount must be a positive integer not above ${originalAmountVnd}, got ${amountVnd}`
    )
  }

  const fields = {
    vnp_RequestId: deps.requestId ?? randomUUID().replace(/-/g, ""), // 32 ký tự chữ-số, không trùng trong ngày
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: options.tmnCode,
    vnp_TransactionType: amountVnd === originalAmountVnd ? "02" : "03",
    vnp_TxnRef: request.txnRef,
    vnp_Amount: toVnpAmount(amountVnd),
    vnp_TransactionNo: request.transactionNo ?? "",
    vnp_TransactionDate: request.transactionDate,
    vnp_CreateBy: request.createBy,
    vnp_CreateDate: formatVnpDate((deps.now ?? new Date()).getTime()),
    vnp_IpAddr: options.ipAddr ?? "127.0.0.1",
    vnp_OrderInfo: request.orderInfo,
  }

  // Chữ ký của refund khác chữ ký của `pay`: chỉ nối GIÁ TRỊ bằng "|" theo thứ tự cố định của tài liệu.
  const signData = [
    fields.vnp_RequestId,
    fields.vnp_Version,
    fields.vnp_Command,
    fields.vnp_TmnCode,
    fields.vnp_TransactionType,
    fields.vnp_TxnRef,
    fields.vnp_Amount,
    fields.vnp_TransactionNo, // rỗng thì vẫn giữ ô rỗng giữa hai dấu "|"
    fields.vnp_TransactionDate,
    fields.vnp_CreateBy,
    fields.vnp_CreateDate,
    fields.vnp_IpAddr,
    fields.vnp_OrderInfo,
  ].join("|")
  const secureHash = createHmac("sha512", options.hashSecret).update(signData).digest("hex")

  // Không gửi vnp_TransactionNo khi rỗng (trường tuỳ chọn).
  const { vnp_TransactionNo, ...rest } = fields
  const body = { ...rest, ...(vnp_TransactionNo ? { vnp_TransactionNo } : {}), vnp_SecureHash: secureHash }

  const response = await (deps.fetch ?? fetch)(options.apiUrl ?? DEFAULT_REFUND_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `VNPAY refund API returned HTTP ${response.status}`)
  }
  const result = (await response.json()) as Record<string, string | undefined>

  if (result.vnp_ResponseCode !== "00") {
    return { ok: false, code: String(result.vnp_ResponseCode), message: result.vnp_Message }
  }
  // 00 là VNPAY nhận yêu cầu; TransactionStatus 09 là VNPAY từ chối hoàn.
  if (result.vnp_TransactionStatus === "09") {
    return { ok: false, code: "09", message: result.vnp_Message }
  }
  return { ok: true, transactionNo: result.vnp_TransactionNo }
}
