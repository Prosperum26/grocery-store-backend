import { z } from "@medusajs/framework/zod"

// StoreAiSuggestByProductsRequest (src/types/ai.ts). Giới hạn khớp AI service (/api/v1/suggest/by-products).
export const AiSuggestByProductsBody = z.object({
  catalog_ids: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  mode: z.enum(["cart", "product"]),
  limit: z.number().int().min(1).max(3).optional(),
  exclude_ids: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
})

export type AiSuggestByProductsBodyType = z.infer<typeof AiSuggestByProductsBody>
