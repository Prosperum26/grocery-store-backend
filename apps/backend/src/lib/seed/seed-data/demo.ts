import type { OrderStage } from "../../order-stage/stages"

// Khách, admin và đơn demo (BE-2c). Mật khẩu không nằm ở đây: seed đọc DEMO_PASSWORD từ .env.
// Thông tin khách khớp mock của storefront (src/lib/mock/customer.ts, orders.ts).

export type DemoAddress = {
  label: string // "Nhà riêng", "Văn phòng"
  address_1: string
  city: string // phường, quận; start-delivery tìm tên quận ở đây để ước giờ tới
  is_default: boolean
}

export type DemoCustomer = {
  email: string
  first_name: string
  last_name: string
  phone: string
  member: boolean // vào nhóm "Thành viên" (mã THANHVIEN15)
  addresses: DemoAddress[]
}

export type DemoOrder = {
  code: string // mã hiển thị, ghi ở metadata.code; display_id do Medusa tự tăng
  customer_email: string
  address_label: string
  stage: OrderStage
  // Mốc chuyển stage. `at` là ISO cố định, hoặc số phút trước lúc seed (đơn "hôm nay").
  timeline: { stage: OrderStage; at: string | number }[]
  items: { sku: string; quantity: number }[]
}

export type DemoData = {
  admin_email: string
  customers: DemoCustomer[]
  orders: DemoOrder[]
}

const MINHTHU = "minhthu@com4fud.demo"

export const DEMO_DATA: DemoData = {
  admin_email: "hoangnam@com4fud.demo",
  customers: [
    {
      email: MINHTHU,
      first_name: "Thư",
      last_name: "Trần Minh",
      phone: "0903412588",
      member: true,
      addresses: [
        { label: "Nhà riêng", address_1: "Căn 12.05, Tháp B, Sky Garden 3", city: "P. Tân Phong, Quận 7, TP.HCM", is_default: true },
        { label: "Văn phòng", address_1: "Tầng 8, 102 Nguyễn Văn Linh", city: "P. Tân Thuận Tây, Quận 7, TP.HCM", is_default: false },
      ],
    },
    // Khách mới chưa có đơn, không thuộc nhóm: "Mua lại" trả empty, ví mã không có THANHVIEN15.
    {
      email: "khachmoi@com4fud.demo",
      first_name: "An",
      last_name: "Nguyễn Văn",
      phone: "0912345678",
      member: false,
      addresses: [
        { label: "Nhà riêng", address_1: "45 Lê Văn Sỹ", city: "P. 13, Quận 3, TP.HCM", is_default: true },
      ],
    },
  ],
  // 5 đơn đầu theo mock ORDERS; trứng, sữa, cà chua, cải thìa lặp lại để "Mua lại" (BE-9) có dữ liệu.
  // 2 đơn cuối để demo khách huỷ (PENDING, BE-8) và "Bắt đầu giao" (PREPARING, BE-7).
  orders: [
    {
      code: "C4F-261007-0142", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "SHIPPING",
      timeline: [
        { stage: "PENDING", at: "2026-10-07T15:12:00+07:00" },
        { stage: "CONFIRMED", at: "2026-10-07T15:14:00+07:00" },
        { stage: "PREPARING", at: "2026-10-07T16:20:00+07:00" },
        { stage: "SHIPPING", at: "2026-10-07T17:02:00+07:00" },
      ],
      items: [
        { sku: "CAT-000892", quantity: 1 }, // cá lóc làm sạch
        { sku: "CAT-000936", quantity: 2 }, // cà chua
        { sku: "CAT-001071", quantity: 1 }, // trứng gà
        { sku: "CAT-000115", quantity: 2 }, // sữa tươi
        { sku: "CAT-001101", quantity: 1 }, // cải thìa
        { sku: "CAT-001094", quantity: 1 }, // húng quế
        { sku: "CAT-001099", quantity: 1 }, // hành lá
      ],
    },
    {
      code: "C4F-261003-0098", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "DELIVERED",
      timeline: [
        { stage: "PENDING", at: "2026-10-03T09:05:00+07:00" },
        { stage: "CONFIRMED", at: "2026-10-03T09:07:00+07:00" },
        { stage: "PREPARING", at: "2026-10-03T09:40:00+07:00" },
        { stage: "SHIPPING", at: "2026-10-03T10:15:00+07:00" },
        { stage: "DELIVERED", at: "2026-10-03T10:41:00+07:00" },
      ],
      items: [
        { sku: "CAT-000969", quantity: 1 }, // gà vườn
        { sku: "CAT-001101", quantity: 2 }, // cải thìa
        { sku: "CAT-000147", quantity: 1 }, // gạo ST25
        { sku: "CAT-001071", quantity: 1 }, // trứng gà
        { sku: "CAT-000115", quantity: 2 }, // sữa tươi
      ],
    },
    {
      code: "C4F-260928-0311", customer_email: MINHTHU, address_label: "Văn phòng", stage: "DELIVERED",
      timeline: [
        { stage: "PENDING", at: "2026-09-28T11:20:00+07:00" },
        { stage: "CONFIRMED", at: "2026-09-28T11:22:00+07:00" },
        { stage: "PREPARING", at: "2026-09-28T11:50:00+07:00" },
        { stage: "SHIPPING", at: "2026-09-28T12:10:00+07:00" },
        { stage: "DELIVERED", at: "2026-09-28T12:34:00+07:00" },
      ],
      items: [
        { sku: "CAT-001071", quantity: 1 }, // trứng gà
        { sku: "CAT-000115", quantity: 2 }, // sữa tươi
        { sku: "CAT-001035", quantity: 1 }, // chuối
      ],
    },
    {
      code: "C4F-260924-0207", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "CANCELLED",
      timeline: [
        { stage: "PENDING", at: "2026-09-24T18:02:00+07:00" },
        { stage: "CANCELLED", at: "2026-09-24T18:09:00+07:00" },
      ],
      items: [
        { sku: "CAT-000915", quantity: 2 }, // tôm thẻ
        { sku: "CAT-001094", quantity: 1 }, // húng quế
      ],
    },
    {
      code: "C4F-260919-0150", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "DELIVERED",
      timeline: [
        { stage: "PENDING", at: "2026-09-19T16:30:00+07:00" },
        { stage: "CONFIRMED", at: "2026-09-19T16:31:00+07:00" },
        { stage: "PREPARING", at: "2026-09-19T17:05:00+07:00" },
        { stage: "SHIPPING", at: "2026-09-19T17:40:00+07:00" },
        { stage: "DELIVERED", at: "2026-09-19T18:02:00+07:00" },
      ],
      items: [
        { sku: "CAT-000994", quantity: 1 }, // ba rọi heo
        { sku: "CAT-001077", quantity: 2 }, // rau muống
        { sku: "CAT-000001", quantity: 1 }, // nước mắm
        { sku: "CAT-001071", quantity: 1 }, // trứng gà
        { sku: "CAT-000936", quantity: 1 }, // cà chua
      ],
    },
    {
      code: "C4F-DEMO-PENDING", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "PENDING",
      timeline: [{ stage: "PENDING", at: 10 }],
      items: [
        { sku: "CAT-000936", quantity: 2 }, // cà chua
        { sku: "CAT-000888", quantity: 1 }, // ức cá basa
        { sku: "CAT-001099", quantity: 1 }, // hành lá
      ],
    },
    {
      code: "C4F-DEMO-PREPARING", customer_email: MINHTHU, address_label: "Nhà riêng", stage: "PREPARING",
      timeline: [
        { stage: "PENDING", at: 45 },
        { stage: "CONFIRMED", at: 43 },
        { stage: "PREPARING", at: 20 },
      ],
      items: [
        { sku: "CAT-000969", quantity: 1 }, // gà vườn
        { sku: "CAT-001071", quantity: 1 }, // trứng gà
        { sku: "CAT-000115", quantity: 2 }, // sữa tươi
        { sku: "CAT-001101", quantity: 1 }, // cải thìa
      ],
    },
  ],
}
