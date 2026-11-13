// Nội dung email xác nhận đơn. Hàm thuần (không đụng DB) để test không cần container Medusa.

export type OrderForEmail = {
  code: string
  name: string
  items: { title: string; variant: string | null; quantity: number; total: number }[]
  subtotal: number
  shipping: number
  discount: number
  total: number
  address: string
  slot: string | null
  note: string | null
  trackUrl: string
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("de-DE")}đ` // 96.500đ: dấu chấm ngăn nghìn như trên web

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** "19:00–21:00, 14/11" từ metadata.slot của đơn (label và startsAt giờ Việt Nam). */
export function slotText(slot: { label?: string; startsAt?: string } | null | undefined): string | null {
  if (!slot?.label) return null
  const day = slot.startsAt?.match(/^\d{4}-(\d{2})-(\d{2})/)
  return day ? `${slot.label}, ${day[2]}/${day[1]}` : slot.label
}

export function buildOrderEmail(order: OrderForEmail): { subject: string; html: string; text: string } {
  const lines = order.items.map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ""} x${i.quantity}: ${vnd(i.total)}`)
  const money = [
    `Tạm tính: ${vnd(order.subtotal)}`,
    `Phí giao hàng: ${vnd(order.shipping)}`,
    ...(order.discount > 0 ? [`Giảm giá: -${vnd(order.discount)}`] : []),
    `Tổng thanh toán: ${vnd(order.total)}`,
  ]
  const delivery = [`Giao tới: ${order.address}`, ...(order.slot ? [`Khung giờ: ${order.slot}`] : []), ...(order.note ? [`Ghi chú: ${order.note}`] : [])]

  const text = [
    `Chào ${order.name},`,
    "",
    `Com4Fud đã nhận đơn ${order.code} và thanh toán qua VNPAY của bạn. Cửa hàng sẽ xác nhận và chuẩn bị hàng.`,
    "",
    ...lines,
    "",
    ...money,
    "",
    ...delivery,
    "",
    `Theo dõi đơn: ${order.trackUrl}`,
  ].join("\n")

  const row = (cells: string[]) => `<tr>${cells.map((c, i) => `<td style="padding:4px 0;${i ? "text-align:right" : ""}">${c}</td>`).join("")}</tr>`
  const html = [
    `<p>Chào ${escapeHtml(order.name)},</p>`,
    `<p>Com4Fud đã nhận đơn <b>${escapeHtml(order.code)}</b> và thanh toán qua VNPAY của bạn. Cửa hàng sẽ xác nhận và chuẩn bị hàng.</p>`,
    `<table style="width:100%;max-width:520px;border-collapse:collapse;font-size:14px">`,
    ...order.items.map((i) => row([`${escapeHtml(i.title)}${i.variant ? ` <span style="color:#666">(${escapeHtml(i.variant)})</span>` : ""} x${i.quantity}`, vnd(i.total)])),
    `<tr><td colspan="2"><hr style="border:0;border-top:1px solid #ddd"></td></tr>`,
    row(["Tạm tính", vnd(order.subtotal)]),
    row(["Phí giao hàng", vnd(order.shipping)]),
    ...(order.discount > 0 ? [row(["Giảm giá", `-${vnd(order.discount)}`])] : []),
    row(["<b>Tổng thanh toán</b>", `<b>${vnd(order.total)}</b>`]),
    `</table>`,
    `<p>${delivery.map(escapeHtml).join("<br>")}</p>`,
    `<p><a href="${escapeHtml(order.trackUrl)}" style="display:inline-block;padding:10px 20px;background:#1f6b3a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Theo dõi đơn</a></p>`,
  ].join("")

  return { subject: `Com4Fud đã nhận đơn ${order.code}`, html, text }
}
