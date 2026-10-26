import type { MedusaContainer } from "@medusajs/framework"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deriveStage } from "../lib/order-stage/stages"

/**
 * Đặt `metadata.stage` cho đơn cũ chưa có, suy từ trạng thái Medusa (deriveStage). Đơn đã có stage
 * không bị đụng, nên chạy lại là an toàn. Dùng order module trực tiếp thay vì setOrderStageWorkflow vì
 * bước chuyển từ "chưa có stage" chỉ cho vào PENDING.
 */
export async function backfillOrderStages(container: MedusaContainer): Promise<{ updated: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const orderModule = container.resolve(Modules.ORDER)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "fulfillment_status", "metadata"],
  })

  let updated = 0
  for (const order of orders as any[]) {
    if (order.metadata?.stage) {
      continue
    }
    const stage = deriveStage(order)
    await orderModule.updateOrders(order.id, {
      metadata: {
        ...(order.metadata ?? {}),
        stage,
        stage_log: [{ stage, at: new Date().toISOString(), by: "backfill" }],
      },
    })
    updated++
  }
  return { updated }
}

// Chạy: npx medusa exec ./src/scripts/backfill-order-stage.ts
export default async function backfill({ container }: ExecArgs) {
  const { updated } = await backfillOrderStages(container)
  console.log(`Backfill order stage: updated ${updated}`)
}
