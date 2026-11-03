import { buildTxnRef, parseTxnRef } from "../lib/txn-ref"

const parses = (ref: string) => {
  try {
    parseTxnRef(ref)
    return true
  } catch {
    return false
  }
}

describe("vnpay txn_ref", () => {
  it("round-trip: parse(build(session, attempt)) trả lại đúng session và attempt", () => {
    expect(parseTxnRef(buildTxnRef("payses_01ABC", 2))).toEqual({ sessionId: "payses_01ABC", attempt: 2 })
  })

  it("chỉ gồm chữ và số, dài 1-100 ký tự", () => {
    const ref = buildTxnRef("payses_01K8Z3Q4M5N6P7R8S9T0V1W2X3", 12)
    expect(ref).toMatch(/^[A-Za-z0-9]{1,100}$/)
  })

  it("hai lần thử khác nhau cho hai txn_ref khác nhau", () => {
    expect(buildTxnRef("payses_01ABC", 1)).not.toBe(buildTxnRef("payses_01ABC", 2))
  })

  it("session id hoặc attempt sai bị từ chối khi build", () => {
    expect(() => buildTxnRef("khong-co-gach-duoi", 1)).toThrow()
    expect(() => buildTxnRef("payses_01ABC", 0)).toThrow()
  })

  it("chuỗi lạ bị từ chối khi parse", () => {
    for (const bad of ["", "abc", "paysesU01ABC", "paysesU01ABCUx", "payses_01ABC"]) {
      expect({ bad, ok: parses(bad) }).toEqual({ bad, ok: false })
    }
  })
})
