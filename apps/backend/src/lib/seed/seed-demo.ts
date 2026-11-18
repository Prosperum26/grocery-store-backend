import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createCustomerAccountWorkflow,
  createCustomerAddressesWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderShipmentWorkflow,
  createOrderWorkflow,
  createReservationsWorkflow,
  createUsersWorkflow,
  linkCustomersToCustomerGroupWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import type { BootstrapResult } from "./bootstrap-store"
import { MEMBER_GROUP_NAME } from "./seed-promotions"
import type { DemoData, DemoOrder } from "./seed-data/demo"

const SHIPPING_METHOD_NAME = "Giao tận nhà"
const SHIPPING_FEE = 15000

// Stage nào thì đơn đã đi tới bước nào của Medusa.
const FULFILLED: DemoOrder["stage"][] = ["PREPARING", "SHIPPING", "DELIVERED"]
const SHIPPED: DemoOrder["stage"][] = ["SHIPPING", "DELIVERED"]

/**
 * Seed admin demo, khách demo và đơn demo (BE-2c). Idempotent: admin và khách tìm theo email, đơn tìm
 * theo metadata.code; cái đã có thì bỏ qua. Cần chạy sau seedCatalog (đơn tra biến thể theo sku) và
 * seedPromotions (nhóm "Thành viên").
 */
export async function seedDemo(
  container: MedusaContainer,
  ctx: BootstrapResult,
  data: DemoData,
  password: string
): Promise<{ admin: boolean; customers: number; orders: number }> {
  const admin = await seedAdmin(container, data.admin_email, password)
  const customerIds = await seedCustomers(container, data, password)
  let orders = 0
  for (const order of data.orders) {
    if (await seedOrder(container, ctx, order, customerIds)) {
      orders++
    }
  }
  return { admin, customers: Object.keys(customerIds).length, orders }
}

// Tạo admin theo đúng các bước của lệnh `medusa user` (giống integration-tests/http/_admin.ts).
async function seedAdmin(container: MedusaContainer, email: string, password: string): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: users } = await query.graph({ entity: "user", fields: ["id"], filters: { email } })
  if (users.length) {
    return false
  }
  const {
    result: [user],
  } = await createUsersWorkflow(container).run({ input: { users: [{ email }] } })
  const authService = container.resolve(Modules.AUTH)
  const { authIdentity, error } = await authService.register("emailpass", { body: { email, password } })
  if (error || !authIdentity) {
    throw new Error(`Không đăng ký được admin ${email}: ${error}`)
  }
  await authService.updateAuthIdentities({ id: authIdentity.id, app_metadata: { user_id: user.id } })
  return true
}

// Trả về map email -> customer id của mọi khách demo (cả khách đã có từ lần seed trước).
async function seedCustomers(
  container: MedusaContainer,
  data: DemoData,
  password: string
): Promise<Record<string, string>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const authService = container.resolve(Modules.AUTH)
  const ids: Record<string, string> = {}

  const { data: groups } = await query.graph({
    entity: "customer_group",
    fields: ["id"],
    filters: { name: MEMBER_GROUP_NAME },
  })

  for (const c of data.customers) {
    const { data: existing } = await query.graph({
      entity: "customer",
      fields: ["id"],
      filters: { email: c.email, has_account: true },
    })
    if (existing.length) {
      ids[c.email] = existing[0].id
      continue
    }

    // Đăng ký emailpass rồi tạo khách gắn với auth identity đó (như POST /store/customers).
    const { authIdentity, error } = await authService.register("emailpass", {
      body: { email: c.email, password },
    })
    if (error || !authIdentity) {
      throw new Error(`Không đăng ký được khách ${c.email}: ${error}`)
    }
    const { result: customer } = await createCustomerAccountWorkflow(container).run({
      input: {
        authIdentityId: authIdentity.id,
        customerData: { email: c.email, first_name: c.first_name, last_name: c.last_name, phone: c.phone },
      },
    })
    ids[c.email] = customer.id

    await createCustomerAddressesWorkflow(container).run({
      input: {
        addresses: c.addresses.map((a) => ({
          customer_id: customer.id,
          address_name: a.label,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          address_1: a.address_1,
          city: a.city,
          country_code: "vn",
          is_default_shipping: a.is_default,
          is_default_billing: a.is_default,
        })),
      },
    })

    if (c.member && groups[0]) {
      await linkCustomersToCustomerGroupWorkflow(container).run({
        input: { id: groups[0].id, add: [customer.id] },
      })
    }
  }
  return ids
}

/**
 * Tạo một đơn demo đi qua đúng các bước Medusa mà một đơn thật đã đi tới stage đó:
 * tạo đơn + giữ hàng (reservation) + đã thanh toán, rồi fulfillment (PREPARING), shipment (SHIPPING),
 * đã giao (DELIVERED). Đơn CANCELLED tạo với status canceled, không giữ hàng, không thanh toán.
 *
 * metadata.stage và stage_log ghi sẵn lúc tạo đơn theo timeline của dữ liệu demo. Các subscriber BE-6
 * vẫn nhận event fulfillment/shipment/delivery nhưng bước chuyển đó không hợp lệ (cùng stage hoặc lùi)
 * nên chỉ ghi cảnh báo, không đổi stage. createOrderWorkflow không nhận created_at, nên ngày đặt thật
 * của đơn cũ chỉ có trong stage_log; created_at là lúc seed.
 */
async function seedOrder(
  container: MedusaContainer,
  ctx: BootstrapResult,
  demo: DemoOrder,
  customerIds: Record<string, string>
): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const customerId = customerIds[demo.customer_email]

  const { data: existing } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { customer_id: customerId },
  })
  if (existing.some((o: any) => o.metadata?.code === demo.code)) {
    return false
  }

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["email", "first_name", "last_name", "phone", "addresses.*"],
    filters: { id: customerId },
  })
  const customer: any = customers[0]
  const address = customer.addresses.find((a: any) => a.address_name === demo.address_label)

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product.title", "inventory_items.inventory_item_id"],
    filters: { sku: demo.items.map((i) => i.sku) },
  })
  const variantRows = variants as any[]
  const bySku = new Map<string, any>(variantRows.map((v) => [v.sku, v]))
  const missing = demo.items.filter((i) => !bySku.has(i.sku)).map((i) => i.sku)
  if (missing.length) {
    throw new Error(`Đơn ${demo.code}: không có biến thể sku ${missing.join(", ")}; chạy seedCatalog trước.`)
  }

  const now = Date.now()
  const stageLog = demo.timeline.map((t) => ({
    stage: t.stage,
    at: typeof t.at === "number" ? new Date(now - t.at * 60_000).toISOString() : new Date(t.at).toISOString(),
    by: "seed",
  }))
  const shippingAddress = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
    address_1: address.address_1,
    city: address.city,
    country_code: "vn",
  }

  // 1. Đơn: giá lấy theo giá đang tính của biến thể (gồm giá khuyến mãi), phí giao 15.000đ.
  const { result: order } = await createOrderWorkflow(container).run({
    input: {
      region_id: ctx.regionId,
      sales_channel_id: ctx.salesChannelId,
      customer_id: customerId,
      email: customer.email,
      currency_code: "vnd",
      status: demo.stage === "CANCELLED" ? "canceled" : "pending",
      shipping_address: shippingAddress,
      billing_address: shippingAddress,
      // Không truyền unit_price: createOrderWorkflow lấy giá đang tính của biến thể (gồm price list
      // khuyến mãi). Truyền vào thì thành giá tuỳ chỉnh. Kiểu DTO bắt buộc unit_price nên phải ép kiểu.
      items: demo.items.map((i) => ({
        variant_id: bySku.get(i.sku).id,
        title: bySku.get(i.sku).product.title,
        quantity: i.quantity,
      })) as any,
      shipping_methods: [
        { name: SHIPPING_METHOD_NAME, amount: SHIPPING_FEE, shipping_option_id: ctx.shippingOptionId },
      ],
      metadata: { code: demo.code, seed: true, stage: demo.stage, stage_log: stageLog },
    },
  })
  if (demo.stage === "CANCELLED") {
    return true
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "items.id", "items.variant_id"],
    filters: { id: order.id },
  })
  const lineItems = (orders[0].items ?? []) as any[]
  const quantityOf = (variantId: string) => demo.items.find((i) => bySku.get(i.sku).id === variantId)!.quantity

  // 2. Giữ hàng tại Kho Q.7, như khi khách hoàn tất giỏ. Fulfillment cần reservation cho biến thể quản kho.
  await createReservationsWorkflow(container).run({
    input: {
      reservations: lineItems.map((li) => ({
        line_item_id: li.id,
        inventory_item_id: variantRows.find((v) => v.id === li.variant_id).inventory_items[0].inventory_item_id,
        location_id: ctx.stockLocationId,
        quantity: quantityOf(li.variant_id),
      })),
    },
  })

  // 3. Đã thanh toán. Đơn thật trả qua VNPAY; ở đây đánh dấu bằng provider hệ thống pp_system_default
  //    (markPaymentCollectionAsPaid chỉ hỗ trợ provider này), nên hoàn tiền khi khách huỷ không gọi VNPAY.
  const { result: paymentCollection } = await createOrderPaymentCollectionWorkflow(container).run({
    input: { order_id: order.id, amount: Number(orders[0].total) },
  })
  await markPaymentCollectionAsPaid(container).run({
    input: { order_id: order.id, payment_collection_id: paymentCollection[0].id, captured_by: "seed" },
  })

  if (!FULFILLED.includes(demo.stage)) {
    return true
  }

  // 4. Đóng gói (PREPARING), giao (SHIPPING), đã giao (DELIVERED).
  const fulfillmentItems = lineItems.map((li) => ({ id: li.id, quantity: quantityOf(li.variant_id) }))
  const { result: fulfillment } = await createOrderFulfillmentWorkflow(container).run({
    input: { order_id: order.id, items: fulfillmentItems, location_id: ctx.stockLocationId },
  })
  if (SHIPPED.includes(demo.stage)) {
    await createOrderShipmentWorkflow(container).run({
      input: { order_id: order.id, fulfillment_id: fulfillment.id, items: fulfillmentItems },
    })
  }
  if (demo.stage === "DELIVERED") {
    await markOrderFulfillmentAsDeliveredWorkflow(container).run({
      input: { orderId: order.id, fulfillmentId: fulfillment.id },
    })
  }
  return true
}
