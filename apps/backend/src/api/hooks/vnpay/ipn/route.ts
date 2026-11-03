import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules, PaymentWebhookEvents } from "@medusajs/framework/utils"
import { fromVnpAmount } from "../../../../modules/vnpay/lib/amount"
import { vnpayOptionsFromEnv } from "../../../../modules/vnpay/lib/options"
import { verifyParams } from "../../../../modules/vnpay/lib/signature"
import { parseTxnRef } from "../../../../modules/vnpay/lib/txn-ref"

// Id provider mà payment module nhận: nó tự thêm tiền tố "pp_" (pp_vnpay_vnpay trong DB).
const WEBHOOK_PROVIDER = "vnpay_vnpay"
const SESSION_PROVIDER_ID = "pp_vnpay_vnpay"

// Mã trả lời IPN theo tài liệu VNPAY.
const RESPONSES = {
  ok: { RspCode: "00", Message: "Confirm Success" },
  notFound: { RspCode: "01", Message: "Order not found" },
  alreadyConfirmed: { RspCode: "02", Message: "Order already confirmed" },
  badAmount: { RspCode: "04", Message: "Invalid amount" },
  badSignature: { RspCode: "97", Message: "Invalid signature" },
  error: { RspCode: "99", Message: "Unknown error" },
}

/**
 * IPN của VNPAY là GET và luôn phải trả HTTP 200 kèm { RspCode, Message } (VNPAY thử lại tối đa
 * 10 lần nếu RspCode không phải 00 hoặc 02). Route POST gốc của Medusa không dùng được vì chỉ nhận POST.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    res.status(200).json(await handleIpn(req))
  } catch (e) {
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`VNPAY IPN failed: ${(e as Error).message}`)
    res.status(200).json(RESPONSES.error)
  }
}

async function handleIpn(req: MedusaRequest) {
  const query = req.query as Record<string, string>

  // 1. Chữ ký.
  if (!verifyParams(query, vnpayOptionsFromEnv().hashSecret)) {
    return RESPONSES.badSignature
  }

  // 2. Phiên thanh toán của giao dịch.
  let sessionId: string
  try {
    sessionId = parseTxnRef(query.vnp_TxnRef).sessionId
  } catch {
    return RESPONSES.notFound
  }
  const graph = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sessions } = await graph.graph({
    entity: "payment_session",
    fields: ["id", "amount", "currency_code", "status", "provider_id", "data", "payment.id"],
    filters: { id: sessionId },
  })
  const session = sessions[0] as any
  if (!session || session.provider_id !== SESSION_PROVIDER_ID) {
    return RESPONSES.notFound
  }

  // 3. Số tiền phải khớp phiên.
  let paidVnd: number
  try {
    paidVnd = fromVnpAmount(Number(query.vnp_Amount))
  } catch {
    return RESPONSES.badAmount
  }
  if (paidVnd !== Number(session.amount)) {
    return RESPONSES.badAmount
  }

  // 4. Đã có payment (đã xử lý xong) thì không làm lại.
  if (session.payment?.id) {
    return RESPONSES.alreadyConfirmed
  }

  // 5. Thanh toán không thành công (khách huỷ, hết hạn...): ghi nhận đã nhận tin, không đổi gì.
  if (query.vnp_ResponseCode !== "00" || query.vnp_TransactionStatus !== "00") {
    return RESPONSES.ok
  }

  // 6. Thanh toán thành công. Ghi dấu đã trả vào phiên: authorizePayment của provider chỉ cho
  //    "authorized" khi có dấu này, nên không thể hoàn tất giỏ trước khi VNPAY xác nhận.
  //    Cũng lưu mã giao dịch VNPAY để BE-8 hoàn tiền. Gọi lại khi đã có dấu thì chỉ phát lại event
  //    (phòng event lần trước bị mất); workflow xử lý lặp là an toàn vì khoá theo giỏ.
  if (session.data?.paid !== true) {
    await req.scope.resolve(Modules.PAYMENT).updatePaymentSession({
      id: session.id,
      amount: session.amount,
      currency_code: session.currency_code,
      data: {
        ...session.data,
        paid: true,
        vnp_transaction_no: query.vnp_TransactionNo,
        vnp_pay_date: query.vnp_PayDate,
      },
    })
  }

  // Phát đúng event mà route POST gốc của Medusa phát (verified-apis S4); subscriber gọi
  // getWebhookActionAndData của provider rồi chạy processPaymentWorkflow (hoàn tất giỏ).
  // delay 0: không chờ 5 giây mặc định.
  await req.scope.resolve(Modules.EVENT_BUS).emit(
    {
      name: PaymentWebhookEvents.WebhookReceived,
      data: { provider: WEBHOOK_PROVIDER, payload: { data: query, rawData: undefined, headers: {} } },
    },
    { delay: 0, attempts: 3 }
  )
  return RESPONSES.ok
}
