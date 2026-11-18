import { canTransition, deriveStage, STAGES, type OrderStage } from "../stages"

// Hàng = trạng thái hiện tại (undefined = đơn chưa có stage), cột = đích. D2: chỉ tiến (được nhảy bước),
// DELIVERED/CANCELLED là điểm cuối, CANCELLED chỉ từ PENDING | CONFIRMED | PREPARING, chuyển về chính nó là không hợp lệ.
const ALLOWED: Record<string, OrderStage[]> = {
  undefined: ["PENDING"],
  PENDING: ["CONFIRMED", "PREPARING", "SHIPPING", "DELIVERED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "SHIPPING", "DELIVERED", "CANCELLED"],
  PREPARING: ["SHIPPING", "DELIVERED", "CANCELLED"],
  SHIPPING: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
}

describe("STAGES", () => {
  it("đúng thứ tự D2", () => {
    expect(STAGES).toEqual(["PENDING", "CONFIRMED", "PREPARING", "SHIPPING", "DELIVERED", "CANCELLED"])
  })
})

describe("canTransition", () => {
  it("các ví dụ chính", () => {
    expect(canTransition("PENDING", "PREPARING")).toBe(true)
    expect(canTransition("PREPARING", "CONFIRMED")).toBe(false)
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false)
    expect(canTransition("SHIPPING", "CANCELLED")).toBe(false)
    expect(canTransition(undefined, "SHIPPING")).toBe(false)
    expect(canTransition(undefined, "PENDING")).toBe(true)
  })

  it("toàn bộ ma trận 7 x 6", () => {
    const froms: (OrderStage | undefined)[] = [undefined, ...STAGES]
    for (const from of froms) {
      for (const to of STAGES) {
        const expected = ALLOWED[String(from)].includes(to)
        expect({ from, to, ok: canTransition(from, to) }).toEqual({ from, to, ok: expected })
      }
    }
  })
})

describe("deriveStage", () => {
  const stage = (status: string, fulfillment_status: string) => deriveStage({ status, fulfillment_status })

  it("đơn huỷ -> CANCELLED (ưu tiên hơn trạng thái giao)", () => {
    expect(stage("canceled", "canceled")).toBe("CANCELLED")
    expect(stage("canceled", "shipped")).toBe("CANCELLED")
  })

  it("theo fulfillment_status", () => {
    expect(stage("pending", "shipped")).toBe("SHIPPING")
    expect(stage("pending", "delivered")).toBe("DELIVERED")
    expect(stage("pending", "fulfilled")).toBe("PREPARING")
    expect(stage("pending", "not_fulfilled")).toBe("PENDING")
  })

  it("trạng thái một phần xếp theo bước chưa hoàn tất", () => {
    expect(stage("pending", "partially_fulfilled")).toBe("PREPARING")
    expect(stage("pending", "partially_shipped")).toBe("SHIPPING")
    expect(stage("pending", "partially_delivered")).toBe("SHIPPING")
  })

  it("giá trị lạ -> PENDING", () => {
    expect(stage("pending", "khong-biet")).toBe("PENDING")
  })
})
