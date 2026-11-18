import { z } from "@medusajs/framework/zod"

// AiAskRequest (src/types/ai.ts), cùng giới hạn với AI service (/api/v1/ask).
export const AiAskBody = z.object({
  recipe_id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(300),
  servings: z.number().int().min(1).max(50).optional(),
  // Các lượt hỏi đáp trước (cũ trước, mới sau) để hỏi nối tiếp; AI service không lưu hội thoại.
  history: z
    .array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(1500) }))
    .max(6)
    .optional(),
})

export type AiAskBodyType = z.infer<typeof AiAskBody>
