import { z } from "@medusajs/framework/zod"

// StoreAiRecipeRequest (src/types/ai.ts), cùng giới hạn với AI service (/api/v1/recipe).
export const AiRecipeBody = z.object({
  recipe_id: z.string().trim().min(1).max(100),
  servings: z.number().int().min(1).max(50).optional(),
  have: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
})

export type AiRecipeBodyType = z.infer<typeof AiRecipeBody>
