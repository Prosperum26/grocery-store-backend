import { z } from "@medusajs/framework/zod"

// ?variant_ids=a,b,c: 1–100 id, bỏ trùng.
export const StockQuery = z.object({
  variant_ids: z
    .string()
    .transform((value) => [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(100)).min(1).max(100)),
  // Giỏ của người gọi (RB-2): cộng lại phần giỏ này đang giữ.
  cart_id: z.string().min(1).max(100).optional(),
})

export type StockQueryType = z.infer<typeof StockQuery>
