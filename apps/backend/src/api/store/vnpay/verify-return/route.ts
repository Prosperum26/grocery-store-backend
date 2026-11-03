import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { vnpayOptionsFromEnv } from "../../../../modules/vnpay/lib/options"
import { verifyParams } from "../../../../modules/vnpay/lib/signature"

/**
 * Trang return của storefront gọi route này để biết kết quả hiển thị cho khách.
 * Chỉ kiểm chữ ký và vnp_ResponseCode; KHÔNG đổi trạng thái đơn hay phiên (V14: chỉ IPN được làm việc đó).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.query as Record<string, string>
  const valid = verifyParams(query, vnpayOptionsFromEnv().hashSecret)
  res.json({ valid, success: valid && query.vnp_ResponseCode === "00" })
}
