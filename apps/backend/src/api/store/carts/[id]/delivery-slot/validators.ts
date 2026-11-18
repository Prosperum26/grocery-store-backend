import { z } from "@medusajs/framework/zod"

export const SetDeliverySlotBody = z.object({
  slot_id: z.string().min(1),
})

export type SetDeliverySlotBodyType = z.infer<typeof SetDeliverySlotBody>
