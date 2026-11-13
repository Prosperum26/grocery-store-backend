import { buildOrderEmail, slotText, type OrderForEmail } from "../order-email"

const ORDER: OrderForEmail = {
  code: "C4F-261113-0008",
  name: "Minh Thư",
  items: [
    { title: "Cà chua", variant: "Túi 500g", quantity: 2, total: 36000 },
    { title: "Cá lóc <phi lê>", variant: null, quantity: 1, total: 96500 },
  ],
  subtotal: 132500,
  shipping: 15000,
  discount: 0,
  total: 147500,
  address: "12 Nguyễn Văn Linh, Phường Tân Phong, Quận 7, TP.HCM",
  slot: "19:00–21:00, 14/11",
  note: null,
  trackUrl: "http://localhost:8000/vn/account/orders/details/order_1",
}

describe("order confirmation email", () => {
  it("names the order code in the subject", () => {
    expect(buildOrderEmail(ORDER).subject).toBe("Com4Fud đã nhận đơn C4F-261113-0008")
  })

  it("lists lines, money, address, slot and the tracking link in the text body", () => {
    const { text } = buildOrderEmail(ORDER)
    expect(text).toContain("Cà chua (Túi 500g) x2: 36.000đ")
    expect(text).toContain("Tổng thanh toán: 147.500đ")
    expect(text).toContain("Khung giờ: 19:00–21:00, 14/11")
    expect(text).toContain(ORDER.trackUrl)
    expect(text).not.toContain("Giảm giá") // no discount line when there is none
    expect(text).not.toContain("Ghi chú")
  })

  it("shows discount and note when there are some", () => {
    const { text } = buildOrderEmail({ ...ORDER, discount: 20000, note: "Gọi trước khi giao" })
    expect(text).toContain("Giảm giá: -20.000đ")
    expect(text).toContain("Ghi chú: Gọi trước khi giao")
  })

  it("escapes product names inside html", () => {
    expect(buildOrderEmail(ORDER).html).toContain("Cá lóc &lt;phi lê&gt;")
  })

  it("formats the slot with its day", () => {
    expect(slotText({ label: "19:00–21:00", startsAt: "2026-11-14T19:00:00+07:00" })).toBe("19:00–21:00, 14/11")
    expect(slotText({ label: "07:00–09:00" })).toBe("07:00–09:00")
    expect(slotText(null)).toBeNull()
  })
})
