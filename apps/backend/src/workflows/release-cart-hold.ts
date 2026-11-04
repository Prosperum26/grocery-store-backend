import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { HOT_STOCK_MODULE } from "../modules/hot-stock"
import type HotStockModuleService from "../modules/hot-stock/service"

// Trả hàng của giỏ. Không cần compensation: trả hàng chạy lại không trả hai lần, hold CONFIRMED thì bỏ qua.
const releaseCartHoldStep = createStep("release-cart-hold", async (input: { cart_id: string }, { container }) => {
  return new StepResponse(await container.resolve<HotStockModuleService>(HOT_STOCK_MODULE).release(input.cart_id))
})

/** VNPAY báo thanh toán không thành công (khách huỷ, thẻ lỗi): trả hàng ngay, không chờ hết 15 phút. */
export const releaseCartHoldWorkflow = createWorkflow("release-cart-hold", (input: { cart_id: string }) => {
  return new WorkflowResponse(releaseCartHoldStep(input))
})
