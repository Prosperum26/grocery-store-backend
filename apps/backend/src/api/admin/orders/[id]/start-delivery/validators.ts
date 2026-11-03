import { z } from "@medusajs/framework/zod"

// Người điều phối nhập tài xế khi bấm "Bắt đầu giao" (API-7). Chỉ giới hạn độ dài: biển số VN có
// nhiều dạng (59-X3 482.17, 51F-123.45), nên không ép theo một mẫu.
export const StartDeliveryBody = z.object({
  driver_name: z.string().trim().min(1).max(100),
  plate: z.string().trim().min(1).max(20),
})

export type StartDeliveryBodyType = z.infer<typeof StartDeliveryBody>
