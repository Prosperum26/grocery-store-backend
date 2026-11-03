import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { COM4FUD, formatVnd } from "../lib/com4fud"

type Summary = {
  revenue_today: number
  orders_today: number
  aov: number
  low_stock_count: number
  revenue_7d: number[]
}

// Nhãn "29/10" của 7 ngày gần nhất theo giờ VN, khớp thứ tự revenue_7d (cũ nhất trước).
const dayLabels = () =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    })
  )

const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <div className="flex flex-col gap-y-1 rounded-lg border border-ui-border-base p-4">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="xlarge" weight="plus">
      {value}
    </Text>
    {note && (
      <Text size="xsmall" className="text-ui-fg-muted">
        {note}
      </Text>
    )}
  </div>
)

// Widget "Tổng quan" trên đầu trang Đơn hàng: trang Admin mở ra sau khi đăng nhập (Medusa không có trang chủ).
const DashboardSummaryWidget = () => {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch("/admin/dashboard/summary", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setSummary)
      .catch(() => setFailed(true))
  }, [])

  const labels = dayLabels()
  const max = Math.max(1, ...(summary?.revenue_7d ?? []))

  return (
    <Container className="flex flex-col gap-y-4 p-6">
      <Heading level="h2">Tổng quan</Heading>
      {failed && <Text size="small">Không tải được số liệu tổng quan.</Text>}
      {!failed && !summary && (
        <Text size="small" className="text-ui-fg-subtle">
          Đang tải…
        </Text>
      )}
      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Doanh thu hôm nay" value={formatVnd(summary.revenue_today)} />
            <Stat label="Đơn hôm nay" value={String(summary.orders_today)} />
            <Stat label="Giá trị đơn trung bình" value={formatVnd(summary.aov)} note="7 ngày gần nhất" />
            <Stat label="Sắp cạn kho" value={`${summary.low_stock_count} món`} note="Xem ở trang Tồn kho" />
          </div>
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">
              Doanh thu 7 ngày (không tính đơn đã huỷ)
            </Text>
            {/* Cột cao theo tỉ lệ với ngày cao nhất; rê chuột để xem số tiền. */}
            <div className="flex h-32 items-end gap-2" role="img" aria-label="Biểu đồ doanh thu 7 ngày">
              {summary.revenue_7d.map((value, i) => (
                <div key={labels[i]} className="flex h-full flex-1 flex-col items-center justify-end gap-y-1">
                  <div
                    title={`${labels[i]}: ${formatVnd(value)}`}
                    className="w-full max-w-10 rounded-t"
                    style={{ height: `${(value / max) * 100}%`, minHeight: 2, background: COM4FUD.brand }}
                  />
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {labels[i]}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default DashboardSummaryWidget
