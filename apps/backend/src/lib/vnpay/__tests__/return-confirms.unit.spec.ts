import { returnConfirmsPayment } from "../return-confirms"

describe("returnConfirmsPayment", () => {
  it("is on outside production when not set", () => {
    expect(returnConfirmsPayment({ NODE_ENV: "development" })).toBe(true)
    expect(returnConfirmsPayment({})).toBe(true)
  })

  it("is off in production when not set", () => {
    expect(returnConfirmsPayment({ NODE_ENV: "production" })).toBe(false)
  })

  it("follows VNPAY_RETURN_AS_IPN when set", () => {
    expect(returnConfirmsPayment({ NODE_ENV: "production", VNPAY_RETURN_AS_IPN: "true" })).toBe(true)
    expect(returnConfirmsPayment({ NODE_ENV: "development", VNPAY_RETURN_AS_IPN: "false" })).toBe(false)
    expect(returnConfirmsPayment({ NODE_ENV: "development", VNPAY_RETURN_AS_IPN: " TRUE " })).toBe(true)
  })
})
