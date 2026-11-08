import { z } from "@medusajs/framework/zod"

// AiAskRequest (src/types/ai.ts), cùng giới hạn với AI service (/api/v1/ask).
export const AiAskBody = z.object({
  recipe_id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(300),
  servings: z.number().int().min(1).max(50).optional(),
})

export type AiAskBodyType = z.infer<typeof AiAskBody>
