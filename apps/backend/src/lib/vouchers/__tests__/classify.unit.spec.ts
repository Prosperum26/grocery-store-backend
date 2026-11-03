import { classifyVoucher, isVisibleToCustomer, toVoucherVM, type PromotionRow } from "../classify"

const NOW = new Date("2026-10-26T05:00:00Z")
const MEMBER_GROUP = "cusgroup_member"

const promo = (overrides: Partial<PromotionRow> = {}): PromotionRow => ({
  code: "TUOI20",
  status: "active",
  metadata: { title: "Giảm 20.000đ", description: "Cho đơn từ 150.000đ" },
  campaign: null,
  application_method: { type: "fixed", target_type: "order", value: 20000, currency_code: "vnd" },
  rules: [],
  ...overrides,
})

const minSubtotalRule = { attribute: "item_subtotal", operator: "gte", values: [{ value: "150000" }] }
const memberRule = { attribute: "customer.groups.id", operator: "eq", values: [{ value: MEMBER_GROUP }] }

describe("classifyVoucher", () => {
  it("mã có campaign đã quá ends_at -> expired", () => {
    const expired = promo({ campaign: { starts_at: null, ends_at: "2026-09-30T00:00:00Z" } })
    expect(classifyVoucher(expired, { now: NOW, customerGroupIds: [] })).toBe("expired")
  })

  it("campaign chưa tới ends_at -> vẫn dùng được", () => {
    const open = promo({ campaign: { starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z" } })
    expect(classifyVoucher(open, { now: NOW, customerGroupIds: [] })).toBe("usable")
  })

  it("campaign chưa bắt đầu -> not_eligible", () => {
    const future = promo({ campaign: { starts_at: "2026-11-01T00:00:00Z", ends_at: null } })
    expect(classifyVoucher(future, { now: NOW, customerGroupIds: [] })).toBe("not_eligible")
  })

  it("mã nhóm 'Thành viên': khách ngoài nhóm -> not_eligible, trong nhóm -> usable", () => {
    const memberOnly = promo({ code: "THANHVIEN15", rules: [memberRule] })
    expect(classifyVoucher(memberOnly, { now: NOW, customerGroupIds: [] })).toBe("not_eligible")
    expect(classifyVoucher(memberOnly, { now: NOW, customerGroupIds: ["cusgroup_khac"] })).toBe("not_eligible")
    expect(classifyVoucher(memberOnly, { now: NOW, customerGroupIds: [MEMBER_GROUP] })).toBe("usable")
  })

  it("TUOI20 tối thiểu 150000: giỏ 100000 -> not_eligible, 200000 -> usable, đúng 150000 -> usable", () => {
    const tuoi20 = promo({ rules: [minSubtotalRule] })
    expect(classifyVoucher(tuoi20, { now: NOW, customerGroupIds: [], cartSubtotal: 100000 })).toBe("not_eligible")
    expect(classifyVoucher(tuoi20, { now: NOW, customerGroupIds: [], cartSubtotal: 200000 })).toBe("usable")
    expect(classifyVoucher(tuoi20, { now: NOW, customerGroupIds: [], cartSubtotal: 150000 })).toBe("usable")
  })

  it("chưa biết giỏ (không có cartSubtotal) thì không xét mức tối thiểu", () => {
    expect(classifyVoucher(promo({ rules: [minSubtotalRule] }), { now: NOW, customerGroupIds: [] })).toBe("usable")
  })

  it("hết hạn được ưu tiên hơn các điều kiện khác", () => {
    const both = promo({ rules: [memberRule], campaign: { ends_at: "2026-09-30T00:00:00Z" } })
    expect(classifyVoucher(both, { now: NOW, customerGroupIds: [] })).toBe("expired")
  })
})

describe("isVisibleToCustomer", () => {
  it("mã công khai hiện với mọi khách", () => {
    expect(isVisibleToCustomer(promo({ rules: [minSubtotalRule] }), [])).toBe(true)
  })

  it("mã giới hạn nhóm chỉ hiện với khách thuộc nhóm (D3)", () => {
    const memberOnly = promo({ rules: [memberRule] })
    expect(isVisibleToCustomer(memberOnly, [])).toBe(false)
    expect(isVisibleToCustomer(memberOnly, [MEMBER_GROUP])).toBe(true)
  })
})

describe("toVoucherVM", () => {
  it("dựng đủ trường hiển thị cho mã cố định có mức tối thiểu", () => {
    const vm = toVoucherVM(promo({ rules: [minSubtotalRule] }), { now: NOW, customerGroupIds: [] })
    expect(vm).toEqual({
      code: "TUOI20",
      title: "Giảm 20.000đ",
      description: "Cho đơn từ 150.000đ",
      discountLabel: "Giảm 20.000đ",
      minSubtotal: 150000,
      endsAt: null,
      status: "usable",
    })
  })

  it("mã phần trăm, có hạn, thiếu metadata thì lấy mã làm tiêu đề", () => {
    const vm = toVoucherVM(
      promo({
        code: "GIAM10",
        metadata: null,
        application_method: { type: "percentage", target_type: "order", value: 10 },
        campaign: { ends_at: "2026-12-31T00:00:00.000Z" },
      }),
      { now: NOW, customerGroupIds: [] }
    )
    expect(vm).toMatchObject({
      title: "GIAM10",
      description: "",
      discountLabel: "Giảm 10%",
      minSubtotal: null,
      endsAt: "2026-12-31T00:00:00.000Z",
    })
  })
})
