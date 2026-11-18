export type VoucherStatus = "usable" | "not_eligible" | "expired"

export type VoucherVM = {
  code: string
  title: string
  description: string
  discountLabel: string
  minSubtotal: number | null
  endsAt: string | null
  status: VoucherStatus
}

type DateLike = string | Date | null | undefined

/** Một promotion như `query.graph` trả về (chỉ các trường ta đọc). */
export type PromotionRow = {
  code: string
  status?: string | null
  metadata?: { title?: string; description?: string } | null
  // Medusa 2.21.1: ngày bắt đầu/kết thúc nằm ở campaign, không phải ở promotion.
  campaign?: { starts_at?: DateLike; ends_at?: DateLike } | null
  application_method?: {
    type?: string | null
    target_type?: string | null
    value?: number | null
    currency_code?: string | null
  } | null
  rules?: { attribute: string; operator: string; values?: { value: string }[] | null }[] | null
}

export type VoucherContext = {
  now: Date
  customerGroupIds: string[]
  /** Tổng tiền hàng của giỏ (item_subtotal). Bỏ trống nếu chưa biết giỏ: khi đó không xét mức tối thiểu. */
  cartSubtotal?: number
}

const GROUP_ATTRIBUTE = "customer.groups.id"
const MIN_SUBTOTAL_ATTRIBUTE = "item_subtotal"

const valuesOf = (rule: { values?: { value: string }[] | null }) => (rule.values ?? []).map((v) => v.value)

/** Các nhóm khách được dùng mã, hoặc null nếu mã công khai (không có rule nhóm). */
function allowedGroupIds(promo: PromotionRow): string[] | null {
  const rules = (promo.rules ?? []).filter(
    (rule) => rule.attribute === GROUP_ATTRIBUTE && (rule.operator === "eq" || rule.operator === "in")
  )
  return rules.length ? rules.flatMap(valuesOf) : null
}

/** Mức tối thiểu của giỏ (rule item_subtotal gte/gt), hoặc null nếu không có. */
function minSubtotalOf(promo: PromotionRow): number | null {
  const rule = (promo.rules ?? []).find(
    (r) => r.attribute === MIN_SUBTOTAL_ATTRIBUTE && (r.operator === "gte" || r.operator === "gt")
  )
  const min = rule ? Number(valuesOf(rule)[0]) : NaN
  return Number.isFinite(min) ? min : null
}

const toDate = (value: DateLike) => (value ? new Date(value) : null)

/**
 * D3: ví mã gồm mã công khai và mã giới hạn nhóm mà khách thuộc.
 * Mã nhóm khác thì không hiện, để khách không biết mã dành riêng cho nhóm họ không ở.
 */
export function isVisibleToCustomer(promo: PromotionRow, customerGroupIds: string[]): boolean {
  const groups = allowedGroupIds(promo)
  return groups === null || groups.some((id) => customerGroupIds.includes(id))
}

/** Hết hạn được xét trước; sau đó tới chưa bắt đầu, nhóm khách, mức tối thiểu của giỏ. */
export function classifyVoucher(promo: PromotionRow, ctx: VoucherContext): VoucherStatus {
  const startsAt = toDate(promo.campaign?.starts_at)
  const endsAt = toDate(promo.campaign?.ends_at)

  if (endsAt && endsAt <= ctx.now) {
    return "expired"
  }
  if (startsAt && startsAt > ctx.now) {
    return "not_eligible"
  }
  if (!isVisibleToCustomer(promo, ctx.customerGroupIds)) {
    return "not_eligible"
  }
  const min = minSubtotalOf(promo)
  if (min !== null && ctx.cartSubtotal !== undefined && ctx.cartSubtotal < min) {
    return "not_eligible"
  }
  return "usable"
}

// 20000 -> "20.000". VND là số nguyên đồng.
const formatVnd = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

function discountLabelOf(promo: PromotionRow): string {
  const method = promo.application_method
  if (method?.type === "percentage") {
    return `Giảm ${method.value ?? 0}%`
  }
  return `Giảm ${formatVnd(method?.value ?? 0)}đ`
}

export function toVoucherVM(promo: PromotionRow, ctx: VoucherContext): VoucherVM {
  const endsAt = promo.campaign?.ends_at
  return {
    code: promo.code,
    title: promo.metadata?.title ?? promo.code,
    description: promo.metadata?.description ?? "",
    discountLabel: discountLabelOf(promo),
    minSubtotal: minSubtotalOf(promo),
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    status: classifyVoucher(promo, ctx),
  }
}
