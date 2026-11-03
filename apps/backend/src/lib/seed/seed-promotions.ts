import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createCustomerGroupsWorkflow, createPromotionsWorkflow } from "@medusajs/medusa/core-flows"

export const MEMBER_GROUP_NAME = "Thành viên"
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Seed nhóm khách "Thành viên" và ba mã giảm giá demo. Idempotent theo `code` / tên nhóm:
 * chạy lại không nhân đôi và không sửa mã đã có. Tiền VND là số nguyên đồng.
 *
 * `ctx.regionId` chưa dùng: mã áp theo `currency_code: "vnd"` nên không cần ràng buộc region.
 */
export async function seedPromotions(container: MedusaContainer, _ctx: { regionId: string }): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Nhóm khách "Thành viên" (dùng cho mã THANHVIEN15).
  const { data: groups } = await query.graph({
    entity: "customer_group",
    fields: ["id"],
    filters: { name: MEMBER_GROUP_NAME },
  })
  const memberGroupId =
    groups[0]?.id ??
    (await createCustomerGroupsWorkflow(container).run({ input: { customersData: [{ name: MEMBER_GROUP_NAME }] } }))
      .result[0].id

  // 2. Các mã còn thiếu. Giảm cố định theo đồng, áp cho toàn đơn (target_type "order").
  const fixedOrderDiscount = (value: number) => ({
    type: "fixed" as const,
    target_type: "order" as const,
    allocation: "across" as const,
    value,
    currency_code: "vnd",
  })

  const wanted = [
    {
      // Công khai; tối thiểu 150.000đ qua rule trên tổng tiền hàng của giỏ (V12: chỉ tạo được bằng workflow/API).
      code: "TUOI20",
      type: "standard" as const,
      status: "active" as const,
      application_method: fixedOrderDiscount(20000),
      rules: [{ attribute: "item_subtotal", operator: "gte" as const, values: ["150000"] }],
      metadata: { title: "Giảm 20.000đ", description: "Cho đơn rau củ tươi từ 150.000đ" },
    },
    {
      // Chỉ khách thuộc nhóm "Thành viên".
      code: "THANHVIEN15",
      type: "standard" as const,
      status: "active" as const,
      application_method: fixedOrderDiscount(15000),
      rules: [{ attribute: "customer.groups.id", operator: "eq" as const, values: [memberGroupId] }],
      metadata: { title: "Ưu đãi thành viên", description: "Giảm 15.000đ cho thành viên Com4Fud" },
    },
    {
      // Ngày kết thúc nằm ở campaign (Medusa 2.21.1); đặt 30 ngày trước lúc seed nên luôn đã hết hạn.
      code: "HETHAN5",
      type: "standard" as const,
      status: "active" as const,
      application_method: fixedOrderDiscount(5000),
      campaign: {
        name: "Khuyến mãi đã kết thúc",
        campaign_identifier: "HETHAN5-DEMO",
        starts_at: new Date(Date.now() - 60 * DAY_MS),
        ends_at: new Date(Date.now() - 30 * DAY_MS),
      },
      metadata: { title: "Giảm 5.000đ", description: "Mã đã hết hạn" },
    },
  ]

  const { data: existing } = await query.graph({ entity: "promotion", fields: ["code"] })
  const existingCodes = new Set(existing.map((p: any) => p.code))
  const missing = wanted.filter((p) => !existingCodes.has(p.code))
  if (missing.length) {
    await createPromotionsWorkflow(container).run({ input: { promotionsData: missing } })
  }
}
