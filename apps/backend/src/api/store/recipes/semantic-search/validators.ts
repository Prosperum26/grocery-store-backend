import { z } from "@medusajs/framework/zod"

// RecipeSearchRequest trong src/types/assistant.ts.
export const RecipeSearchBody = z.object({
  query: z.string().trim().min(1).max(200),
  servings: z.number().int().min(1).max(20).optional(),
  limit: z.number().int().min(1).max(10).optional(),
})
