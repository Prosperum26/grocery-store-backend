import SmtpNotificationProviderService from "../service"

const sendMail = jest.fn()
const createTransport = jest.fn(() => ({ sendMail }))
jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport: (...a: unknown[]) => (createTransport as any)(...a) } }))

const options = { host: "smtp.gmail.com", port: 465, user: "shop@example.com", pass: "app-password", from: "Com4Fud <shop@example.com>" }

describe("SmtpNotificationProviderService", () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: "<abc@example.com>" })
    createTransport.mockClear()
  })

  it("requires every option", () => {
    expect(() => SmtpNotificationProviderService.validateOptions(options)).not.toThrow()
    for (const key of Object.keys(options)) {
      expect(() => SmtpNotificationProviderService.validateOptions({ ...options, [key]: "" })).toThrow(key)
    }
  })

  it("uses TLS on 465 and STARTTLS on 587", () => {
    new SmtpNotificationProviderService({}, options)
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }))
    new SmtpNotificationProviderService({}, { ...options, port: 587 })
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: false }))
  })

  it("sends the prepared subject and html from the configured sender", async () => {
    const service = new SmtpNotificationProviderService({}, options)
    const result = await service.send({
      to: "khach@example.com",
      channel: "email",
      template: "",
      content: { subject: "Đặt lại mật khẩu", html: "<p>hi</p>", text: "hi" },
    })
    expect(result).toEqual({ id: "<abc@example.com>" })
    expect(sendMail).toHaveBeenCalledWith({
      from: options.from,
      to: "khach@example.com",
      subject: "Đặt lại mật khẩu",
      html: "<p>hi</p>",
      text: "hi",
    })
  })

  it("refuses a notification without content", async () => {
    const service = new SmtpNotificationProviderService({}, options)
    await expect(service.send({ to: "khach@example.com", channel: "email", template: "x" })).rejects.toThrow("content.subject")
    expect(sendMail).not.toHaveBeenCalled()
  })
})
