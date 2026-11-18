import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  isVisibleToCustomer,
  toVoucherVM,
  type PromotionRow,
  type VoucherStatus,
} from "../../../../../lib/vouchers/classify"

// Thứ tự hiển thị trong ví: dùng được trước, rồi chưa đủ điều kiện, rồi hết hạn.
const STATUS_ORDER: Record<VoucherStatus, number> = { usable: 0, not_eligible: 1, expired: 2 }

const PROMOTION_FIELDS = [
  "code",
  "status",
  "metadata",
  "campaign.starts_at",
  "campaign.ends_at",
  "application_method.type",
  "application_method.target_type",
  "application_method.value",
  "application_method.currency_code",
  "rules.attribute",
  "rules.operator",
  "rules.values.value",
]

/** Ví mã của khách đang đăng nhập (D3: mã công khai và mã nhóm mà khách thuộc). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "groups.id"],
    filters: { id: req.auth_context.actor_id },
  })
  const customerGroupIds = ((customers[0] as any)?.groups ?? []).map((g: { id: string }) => g.id)

  // Mã tự động (is_automatic) tự áp vào giỏ nên không thuộc ví; mã nháp/ngưng không hiển thị.
  const { data: promotions } = await query.graph({
    entity: "promotion",
    fields: PROMOTION_FIELDS,
    filters: { status: "active", is_automatic: false },
  })

  const ctx = { now: new Date(), customerGroupIds }
  const vouchers = (promotions as unknown as PromotionRow[])
    .filter((promo) => isVisibleToCustomer(promo, customerGroupIds))
    .map((promo) => toVoucherVM(promo, ctx))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.code.localeCompare(b.code))

  res.json({ vouchers })
}
