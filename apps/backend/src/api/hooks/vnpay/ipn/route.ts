import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { handleIpn, RESPONSES } from "../../../../lib/vnpay/handle-ipn"

/**
 * IPN của VNPAY là GET và luôn phải trả HTTP 200 kèm { RspCode, Message } (VNPAY thử lại tối đa
 * 10 lần nếu RspCode không phải 00 hoặc 02). Route POST gốc của Medusa không dùng được vì chỉ nhận POST.
 * Toàn bộ kiểm tra nằm ở lib/vnpay/handle-ipn.ts.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    res.status(200).json(await handleIpn(req.scope, req.query as Record<string, string>))
  } catch (e) {
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).error(`VNPAY IPN failed: ${(e as Error).message}`)
    res.status(200).json(RESPONSES.error)
  }
}
