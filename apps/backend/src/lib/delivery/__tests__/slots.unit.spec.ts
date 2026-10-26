import { DELIVERY_FEE_VND, listSlots } from "../slots"

const byId = (slots: ReturnType<typeof listSlots>, id: string) => slots.find((s) => s.id === id)

describe("listSlots", () => {
  it("23:30 giờ VN: khung sáng mai còn đặt được, mọi khung hôm nay đã qua", () => {
    // 2026-10-26T16:30:00Z = 23:30 ngày 26 theo UTC+7
    const slots = listSlots(new Date("2026-10-26T16:30:00Z"))

    expect(byId(slots, "2026-10-27T07")?.available).toBe(true)
    const today = slots.filter((s) => s.id.startsWith("2026-10-26T"))
    expect(today.length).toBeGreaterThan(0)
    expect(today.every((s) => s.available === false)).toBe(true)
  })

  it("khung bắt đầu trong vòng 60 phút tới thì không đặt được", () => {
    // 15:00 VN: khung 15h đã bắt đầu, khung 17h còn 2 giờ.
    const at1500 = listSlots(new Date("2026-10-26T08:00:00Z"))
    expect(byId(at1500, "2026-10-26T15")?.available).toBe(false)
    expect(byId(at1500, "2026-10-26T17")?.available).toBe(true)

    // 16:30 VN: khung 17h bắt đầu sau 30 phút.
    const at1630 = listSlots(new Date("2026-10-26T09:30:00Z"))
    expect(byId(at1630, "2026-10-26T17")?.available).toBe(false)
    expect(byId(at1630, "2026-10-26T19")?.available).toBe(true)
  })

  it("đúng 60 phút trước giờ bắt đầu thì còn đặt được, thiếu 1 giây thì không", () => {
    expect(byId(listSlots(new Date("2026-10-26T09:00:00Z")), "2026-10-26T17")?.available).toBe(true)
    expect(byId(listSlots(new Date("2026-10-26T09:00:01Z")), "2026-10-26T17")?.available).toBe(false)
  })

  it("phí giao luôn là 15000", () => {
    const slots = listSlots(new Date("2026-10-26T05:00:00Z"), { days: 3 })
    expect(DELIVERY_FEE_VND).toBe(15000)
    expect(slots.every((s) => s.fee === 15000)).toBe(true)
  })

  it("23:59:59 và 00:00:01 giờ VN thuộc hai ngày khác nhau", () => {
    const before = listSlots(new Date("2026-10-26T16:59:59Z"))
    const after = listSlots(new Date("2026-10-26T17:00:01Z"))
    expect(before[0].id.startsWith("2026-10-26T")).toBe(true)
    expect(after[0].id.startsWith("2026-10-27T")).toBe(true)
  })

  it("trả khung giờ theo thứ tự, nhãn và mốc thời gian theo UTC+7", () => {
    const slots = listSlots(new Date("2026-10-26T16:30:00Z"))
    expect(slots.map((s) => s.id)).toEqual(
      [...slots.map((s) => s.id)].sort()
    )
    expect(byId(slots, "2026-10-27T07")).toEqual({
      id: "2026-10-27T07",
      label: "07:00–09:00",
      startsAt: "2026-10-27T07:00:00+07:00",
      endsAt: "2026-10-27T09:00:00+07:00",
      fee: 15000,
      available: true,
    })
  })

  it("mặc định trả hôm nay và ngày mai; days đổi số ngày", () => {
    const now = new Date("2026-10-26T05:00:00Z")
    const perDay = new Set(listSlots(now, { days: 1 }).map((s) => s.id.slice(0, 10)))
    expect([...perDay]).toEqual(["2026-10-26"])
    expect(new Set(listSlots(now).map((s) => s.id.slice(0, 10))).size).toBe(2)
    expect(new Set(listSlots(now, { days: 3 }).map((s) => s.id.slice(0, 10))).size).toBe(3)
  })
})
