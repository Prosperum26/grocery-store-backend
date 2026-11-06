import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"

// Trả hàng của các hold quá hạn. Không cần compensation: mỗi hold được trả trong một script nguyên tử,
// chạy lại hay chạy song song cũng không trả hai lần.
const expireHoldsStep = createStep("expire-hot-stock-holds", async (input: { now?: number }, { container }) => {
  const released = await container.resolve<HotStockModuleService>(HOT_STOCK_MODULE).expireDue({ now: input.now })
  return new StepResponse(released)
})

/** Hold quá 15 phút → EXPIRED, hàng về kho (plan hot-stock HS-5). `now` (giây) chỉ dùng trong test. */
export const expireHoldsWorkflow = createWorkflow("expire-hot-stock-holds", (input: { now?: number }) => {
  return new WorkflowResponse(expireHoldsStep(input))
})
