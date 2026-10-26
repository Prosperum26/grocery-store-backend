import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { listSlots } from "../lib/delivery/slots"

// Đọc giờ hiện tại trong step (không trong workflow) để mỗi lần chạy lấy đúng thời điểm gọi.
const listDeliverySlotsStep = createStep("list-delivery-slots", async () => {
  return new StepResponse(listSlots(new Date()))
})

export const listDeliverySlotsWorkflow = createWorkflow("list-delivery-slots", () => {
  return new WorkflowResponse(listDeliverySlotsStep())
})
