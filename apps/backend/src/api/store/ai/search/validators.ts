import { z } from "@medusajs/framework/zod"

// StoreAiSearchRequest (src/types/ai.ts), cùng giới hạn với AI service (/api/v1/search, docs/contracts/ai-service.md).
// Dùng cho cả /store/ai/search và /store/ai/copilot.
export const AiSearchBody = z.object({
  query: z.string().trim().min(1).max(300),
  servings: z.number().int().min(1).max(50).optional(),
  top_k: z.number().int().min(1).max(10).optional(),
  have: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
})

export type AiSearchBodyType = z.infer<typeof AiSearchBody>
