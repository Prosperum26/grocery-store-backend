import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AI_UNAVAILABLE } from "./client"

/**
 * Lỗi "AI không trả lời được và không có bản dự phòng" thành 503 { code: "AI_UNAVAILABLE" } (ai-copilot.md, mục 4).
 * Error handler của Medusa ghi đè `code` của lỗi, nên route tự trả; lỗi khác thì ném tiếp.
 */
export function respondIfAiUnavailable(res: MedusaResponse, error: unknown): void {
  if (MedusaError.isMedusaError(error) && error.code === AI_UNAVAILABLE) {
    res.status(503).json({ code: AI_UNAVAILABLE, type: error.type, message: "Trợ lý Bếp tạm nghỉ, bạn thử lại sau" })
    return
  }
  throw error
}
