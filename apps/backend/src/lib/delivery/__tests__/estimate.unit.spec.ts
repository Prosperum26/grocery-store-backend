import { estimateDelivery } from "../estimate"

describe("estimateDelivery", () => {
  const startedAt = new Date("2026-10-27T10:00:00Z")

  it("Quận 7 (3 km, 20 km/h) mất 9 phút", () => {
    const result = estimateDelivery("Quận 7", startedAt)
    expect(result.distanceKm).toBe(3)
    expect(result.minutes).toBe(9)
  })

  it("Quận 1 (10 km) mất 30 phút", () => {
    const result = estimateDelivery("Quận 1", startedAt)
    expect(result.distanceKm).toBe(10)
    expect(result.minutes).toBe(30)
  })

  it("quận lạ dùng mặc định 6 km, tức 18 phút, không ném lỗi", () => {
    const result = estimateDelivery("Quận Không Có", startedAt)
    expect(result.distanceKm).toBe(6)
    expect(result.minutes).toBe(18)
  })

  it("etaAt = startedAt + minutes", () => {
    const result = estimateDelivery("Quận 1", startedAt)
    expect(result.etaAt.getTime()).toBe(startedAt.getTime() + 30 * 60 * 1000)
    // Không sửa đối tượng Date truyền vào.
    expect(startedAt.toISOString()).toBe("2026-10-27T10:00:00.000Z")
  })

  it("làm tròn lên phút (ceil)", () => {
    // Quận 8 cách 5,5 km -> 16,5 phút -> 17 phút.
    const result = estimateDelivery("Quận 8", startedAt)
    expect(result.distanceKm).toBe(5.5)
    expect(result.minutes).toBe(17)
  })

  it("bỏ qua hoa thường, dấu cách thừa và tiền tố 'Q.'", () => {
    expect(estimateDelivery("  quận 7 ", startedAt).minutes).toBe(9)
    expect(estimateDelivery("Q.7", startedAt).minutes).toBe(9)
    expect(estimateDelivery("Quan 7", startedAt).minutes).toBe(9)
  })

  it("thiếu quận (undefined hoặc chuỗi rỗng) dùng mặc định", () => {
    expect(estimateDelivery(undefined, startedAt).minutes).toBe(18)
    expect(estimateDelivery("", startedAt).minutes).toBe(18)
  })
})
