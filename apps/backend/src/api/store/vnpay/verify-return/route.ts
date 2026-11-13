import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { vnpayOptionsFromEnv } from "../../../../modules/vnpay/lib/options"
import { verifyParams } from "../../../../modules/vnpay/lib/signature"
import { handleIpn } from "../../../../lib/vnpay/handle-ipn"
import { returnConfirmsPayment } from "../../../../lib/vnpay/return-confirms"

/**
 * Trang return của storefront gọi route này để biết kết quả hiển thị cho khách: kiểm chữ ký và vnp_ResponseCode.
 * Khi returnConfirmsPayment() bật (mặc định ở dev), chữ ký đúng thì chạy luôn handleIpn như một IPN, vì ở localhost
 * IPN thật không tới được (xem return-confirms.ts). handleIpn tự bỏ qua nếu IPN đã xử lý trước đó.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.query as Record<string, string>
  const valid = verifyParams(query, vnpayOptionsFromEnv().hashSecret)
  if (valid && returnConfirmsPayment()) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const result = await handleIpn(req.scope, query)
      logger.info(`VNPAY return handled as IPN: ${result.RspCode} ${result.Message} (txn ${query.vnp_TxnRef})`)
    } catch (e) {
      logger.error(`VNPAY return as IPN failed: ${(e as Error).message}`)
    }
  }
  res.json({ valid, success: valid && query.vnp_ResponseCode === "00" })
}
