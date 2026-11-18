import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { CART_COMPLETED, OUT_OF_STOCK, reserveCartStockWorkflow } from "../../../../../workflows/reserve-cart-stock"

// API-14: giữ hàng cả giỏ trước khi tạo phiên VNPAY. Body rỗng.
// 200 { hold } · 409 { code: OUT_OF_STOCK, items } · 409 { code: CART_COMPLETED } · 404 giỏ lạ · 400 giỏ trống.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { result } = await reserveCartStockWorkflow(req.scope).run({ input: { cart_id: req.params.id } })
    if (result.status === "out_of_stock") {
      res.status(409).json({ code: OUT_OF_STOCK, message: "Some items are out of stock", items: result.items })
      return
    }
    res.json({ hold: result.hold })
  } catch (e) {
    // Error handler của Medusa ghi đè `code` của lỗi CONFLICT (như BE-4), nên tự trả 409 với mã riêng.
    if (MedusaError.isMedusaError(e) && e.code === CART_COMPLETED) {
      res.status(409).json({ code: CART_COMPLETED, type: e.type, message: e.message })
      return
    }
    throw e
  }
}
