import { z } from "@medusajs/framework/zod"

// AssistantChatRequest trong src/types/assistant.ts.
export const AssistantChatBody = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(20)
    .optional(),
  cart_id: z.string().min(1).optional(),
})
