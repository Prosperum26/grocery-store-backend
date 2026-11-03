import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listDeliverySlotsWorkflow } from "../../../workflows/list-delivery-slots"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { result: slots } = await listDeliverySlotsWorkflow(req.scope).run()
  res.json({ slots })
}
