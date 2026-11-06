import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { expireHoldsWorkflow } from "../workflows/expire-holds"

/**
 * Mỗi phút trả hàng của các hold quá hạn (tối đa 200 hold một lần). Hold không có TTL trong Redis,
 * nên job này là thứ duy nhất trả hàng khi khách bỏ giữa chừng. Hạn thực tế vì vậy là 15–16 phút.
 */
export default async function expireHolds(container: MedusaContainer) {
  const { result: released } = await expireHoldsWorkflow(container).run({ input: {} })
  if (released) {
    container.resolve(ContainerRegistrationKeys.LOGGER).info(`hot-stock: released ${released} expired holds`)
  }
  return released
}

export const config = {
  name: "expire-hot-stock-holds",
  schedule: "* * * * *",
}
