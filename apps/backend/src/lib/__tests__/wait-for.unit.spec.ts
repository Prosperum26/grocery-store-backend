import { waitFor } from "../../../integration-tests/http/_helpers"

describe("waitFor", () => {
  it("trả giá trị ngay khi điều kiện thỏa", async () => {
    await expect(waitFor(async () => 42)).resolves.toBe(42)
  })

  it("thử lại tới khi có giá trị", async () => {
    let calls = 0
    const value = await waitFor(async () => (++calls < 3 ? undefined : "ok"), { intervalMs: 5 })
    expect(value).toBe("ok")
    expect(calls).toBe(3)
  })

  it("coi 0 và chuỗi rỗng là giá trị hợp lệ (chỉ undefined/false là chưa xong)", async () => {
    await expect(waitFor(async () => 0)).resolves.toBe(0)
  })

  it("ném lỗi khi quá thời gian", async () => {
    await expect(waitFor(async () => false, { timeoutMs: 30, intervalMs: 5 })).rejects.toThrow(/waitFor/)
  })
})
