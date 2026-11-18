import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { getVariantStockWorkflow } from "../../../workflows/get-variant-stock"
import type { StockQueryType } from "./validators"

// API-15: GET /store/stock?variant_ids=a,b[&cart_id=] → { stock: [{ variant_id, inventory_item_id, location_id, available, held_by_cart }] }.
// Số đã trừ phần đang được giữ; FE dùng làm giá trị đầu và khi Socket.io kết nối lại (API-16).
export async function GET(req: MedusaStoreRequest<unknown, StockQueryType>, res: MedusaResponse) {
  const { result } = await getVariantStockWorkflow(req.scope).run({
    input: {
      variant_ids: req.validatedQuery.variant_ids as unknown as string[],
      sales_channel_ids: req.publishable_key_context.sales_channel_ids,
      cart_id: req.validatedQuery.cart_id,
    },
  })
  res.json({ stock: result })
}
