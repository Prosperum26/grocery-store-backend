import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getDashboardSummaryWorkflow } from "../../../../workflows/get-dashboard-summary"

// API-9: { revenue_today, orders_today, aov, low_stock_count, revenue_7d }. /admin/* do core xác thực.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { result } = await getDashboardSummaryWorkflow(req.scope).run()
  res.json(result)
}
