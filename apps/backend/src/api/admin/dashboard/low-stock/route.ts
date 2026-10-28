import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listLowStockWorkflow } from "../../../../workflows/get-dashboard-summary"

// Danh sách sắp cạn kho: { items: [{ product_id, title, variant_title, sku, available, low_stock }], count }.
// ?limit= mặc định 10, tối đa 100.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100)
  const { result } = await listLowStockWorkflow(req.scope).run({ input: { limit } })
  res.json(result)
}
