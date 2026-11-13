import { buildResetPasswordEmail, buildResetUrl } from "../reset-password-email"

describe("reset password email", () => {
  it("builds a storefront link and encodes token and email", () => {
    const url = buildResetUrl("http://localhost:8000/", "a+b@example.com", "x.y/z=")
    expect(url).toBe("http://localhost:8000/vn/reset-password?token=x.y%2Fz%3D&email=a%2Bb%40example.com")
  })

  it("puts the link in both the html and the text body", () => {
    const url = "http://localhost:8000/vn/reset-password?token=t&email=a%40b.c"
    const mail = buildResetPasswordEmail(url)
    expect(mail.subject).toContain("mật khẩu")
    expect(mail.text).toContain(url)
    // Trong HTML dấu & của query phải viết là &amp;.
    expect(mail.html).toContain('href="http://localhost:8000/vn/reset-password?token=t&amp;email=a%40b.c"')
  })

  it("escapes the link inside html", () => {
    const mail = buildResetPasswordEmail('http://x/?a="1"&b=<2>')
    expect(mail.html).not.toContain('"1"')
    expect(mail.html).toContain("&quot;1&quot;&amp;b=&lt;2&gt;")
  })
})
