import { orderCode } from "../order-code"

describe("orderCode", () => {
  it("ghép ngày theo giờ VN và display_id đủ 4 số", () => {
    expect(orderCode(new Date("2026-11-03T08:00:00Z"), 42)).toBe("C4F-261103-0042")
  })

  it("17:00 UTC trở đi đã là ngày hôm sau ở Việt Nam", () => {
    expect(orderCode(new Date("2026-11-02T16:59:59Z"), 7)).toBe("C4F-261102-0007")
    expect(orderCode(new Date("2026-11-02T17:00:00Z"), 7)).toBe("C4F-261103-0007")
  })

  it("display_id quá 9999 thì giữ đủ chữ số", () => {
    expect(orderCode(new Date("2026-11-03T08:00:00Z"), 12345)).toBe("C4F-261103-12345")
  })
})
