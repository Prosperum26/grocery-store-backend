import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { estimateDaysLeft, SCHEDULE_TODAY_LIMIT } from "../lib/predictive/reorder"
import { inStockTotal, loadReorderData, ReorderBasketItem } from "./get-reorder-basket"

/**
 * Trang "Mua lại": `today` là top 10 theo model. `upcoming` là các món đã mua còn lại, kèm số ngày
 * ước tính từ chu kỳ mua của khách (model không dự đoán số ngày). AI lỗi thì `today` rỗng.
 */

export type ReorderSchedule = {
  status: "ready" | "empty"
  today: ReorderBasketItem[]
  upcoming: (ReorderBasketItem & { days_left: number })[]
  total: number // tổng các món còn hàng trong `today`
}

const loadReorderScheduleStep = createStep(
  "load-reorder-schedule",
  async (input: { customer_id: string }, { container }) => {
    const data = await loadReorderData(container, input.customer_id)
    if (!data) {
      return new StepResponse<ReorderSchedule>({ status: "empty", today: [], upcoming: [], total: 0 })
    }

    const today = data.ranked.slice(0, SCHEDULE_TODAY_LIMIT)
    const todayIds = new Set(today.map((i) => i.variant_id))
    const daysLeft = estimateDaysLeft(data.delivered, new Date())
    const upcoming = data.purchased
      .filter((i) => !todayIds.has(i.variant_id))
      .map((i) => ({ ...i, days_left: daysLeft.get(i.variant_id) ?? 0 }))
      .sort((a, b) => a.days_left - b.days_left || a.title.localeCompare(b.title))

    return new StepResponse<ReorderSchedule>({
      status: today.length || upcoming.length ? "ready" : "empty",
      today,
      upcoming,
      total: inStockTotal(today),
    })
  }
)

export const getReorderScheduleWorkflow = createWorkflow(
  "get-reorder-schedule",
  (input: { customer_id: string }) => {
    return new WorkflowResponse(loadReorderScheduleStep(input))
  }
)
