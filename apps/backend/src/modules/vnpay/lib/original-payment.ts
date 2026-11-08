import { MedusaError } from "@medusajs/framework/utils"
import { fromVnpAmount } from "./amount"

// Lấy lại thông tin của giao dịch gốc từ data của payment. `payment_url` là URL đã ký của lần thử đã trả
// (txn_ref và URL luôn cùng một lần thử), nên vnp_CreateDate và vnp_Amount của request `pay` đọc được từ đó.
export function readOriginalPayment(data: Record<string, unknown>) {
  const invalid = () =>
    new MedusaError(MedusaError.Types.INVALID_DATA, "Payment data has no VNPAY txn_ref and payment_url, cannot refund")

  let query: URLSearchParams
  try {
    query = new URL(String(data.payment_url)).searchParams
  } catch {
    throw invalid()
  }
  const createDate = query.get("vnp_CreateDate")
  if (!data.txn_ref || !createDate) {
    throw invalid()
  }
  try {
    return { txnRef: String(data.txn_ref), createDate, amountVnd: fromVnpAmount(Number(query.get("vnp_Amount"))) }
  } catch {
    throw invalid()
  }
}
