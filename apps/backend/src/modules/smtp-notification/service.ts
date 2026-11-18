import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import nodemailer, { type Transporter } from "nodemailer"

export type SmtpOptions = {
  host: string
  port: number
  /** Thiếu user hoặc pass thì không gửi thật: chỉ ghi nội dung email ra log (để thử luồng khi chưa có hộp thư). */
  user?: string
  pass?: string
  from: string
}

// Gửi email qua SMTP (Gmail + mật khẩu ứng dụng). Medusa không có sẵn provider SMTP nên nhóm tự viết.
// Chỉ làm kênh "email"; nội dung (subject, html, text) do nơi gọi tạo sẵn, provider không có template.
class SmtpNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "smtp-notification"

  protected options_: SmtpOptions
  protected transporter_: Transporter | null
  protected logger_: { info: (msg: string) => void }

  constructor(container: Record<string, unknown>, options: SmtpOptions) {
    super()
    this.options_ = options
    this.logger_ = (container.logger as { info: (msg: string) => void } | undefined) ?? console
    this.transporter_ = !options.user || !options.pass ? null : nodemailer.createTransport({
      host: options.host,
      port: options.port,
      // Cổng 465 dùng TLS ngay từ đầu; cổng khác (587) nâng cấp bằng STARTTLS nên secure=false.
      secure: options.port === 465,
      // Gmail hiển thị mật khẩu ứng dụng thành 4 nhóm cách nhau bằng dấu cách; dán nguyên vào .env vẫn dùng được.
      auth: { user: options.user, pass: options.pass.replace(/\s+/g, "") },
    })
  }

  static validateOptions(options: Record<string, unknown>) {
    for (const key of ["host", "port", "from"]) {
      if (!options[key]) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Option \`${key}\` is required in the SMTP provider's options.`)
      }
    }
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const { content } = notification
    if (!content?.subject || (!content.html && !content.text)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "SMTP notification needs content.subject and content.html or content.text.")
    }

    if (!this.transporter_) {
      this.logger_.info(`[email not sent, no SMTP account] to=${notification.to} subject=${content.subject}
${content.text ?? content.html}`)
      return { id: "logged-only" }
    }

    const info = await this.transporter_.sendMail({
      from: notification.from || this.options_.from,
      to: notification.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
    return { id: info.messageId }
  }
}

export default SmtpNotificationProviderService
