import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { availableOf, VARIANT_STOCK_FIELDS } from "../lib/inventory/available"
import {
  DashboardSummary,
  DEFAULT_LOW_STOCK,
  lowStockItems,
  summarizeOrders,
  VariantStock,
} from "../lib/dashboard/summary"

// Tồn của mọi biến thể quản kho thuộc sản phẩm đang hiện, kèm ngưỡng low_stock của sản phẩm.
async function loadVariantStock(container: any): Promise<VariantStock[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "title", "product.id", "product.title", "product.status", "product.metadata", ...VARIANT_STOCK_FIELDS],
  })
  return (data as any[])
    .filter((v) => v.product?.status === "published" && v.manage_inventory !== false)
    .map((v) => ({
      product_id: v.product.id,
      title: v.product.title,
      variant_title: v.title,
      sku: v.sku,
      available: availableOf(v),
      low_stock: typeof v.product.metadata?.low_stock === "number" ? v.product.metadata.low_stock : DEFAULT_LOW_STOCK,
    }))
}

// Đọc giờ hiện tại trong step để mỗi lần gọi tính theo đúng thời điểm.
const loadDashboardSummaryStep = createStep("load-dashboard-summary", async (_: void, { container }) => {
  const now = new Date()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  // Lấy dư 8 ngày; summarizeOrders tự cắt đúng 7 ngày theo giờ VN.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "created_at", "total"],
    filters: { created_at: { $gte: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) } },
  })
  const summary: DashboardSummary = {
    ...summarizeOrders(orders as any[], now),
    low_stock_count: lowStockItems(await loadVariantStock(container)).length,
  }
  return new StepResponse(summary)
})

/** Số liệu widget Tổng quan (API-9): doanh thu, số đơn hôm nay, giá trị đơn trung bình, số món sắp cạn, 7 ngày. */
export const getDashboardSummaryWorkflow = createWorkflow("get-dashboard-summary", () => {
  return new WorkflowResponse(loadDashboardSummaryStep())
})

const listLowStockStep = createStep("list-low-stock", async (input: { limit: number }, { container }) => {
  const items = lowStockItems(await loadVariantStock(container))
  return new StepResponse({ items: items.slice(0, input.limit), count: items.length })
})

/** Danh sách sắp cạn kho cho widget Admin: ít hàng nhất trước, tối đa `limit` dòng, kèm tổng số. */
export const listLowStockWorkflow = createWorkflow("list-low-stock", (input: { limit: number }) => {
  return new WorkflowResponse(listLowStockStep(input))
})
