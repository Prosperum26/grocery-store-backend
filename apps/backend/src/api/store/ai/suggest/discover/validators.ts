import { z } from "@medusajs/framework/zod"

// StoreAiDiscoverRequest (src/types/ai.ts). `have` là SKU trong giỏ hiện tại; khách lấy từ phiên đăng nhập, không từ body.
export const AiDiscoverBody = z.object({
  exclude_ids: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  have: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
})

export type AiDiscoverBodyType = z.infer<typeof AiDiscoverBody>
