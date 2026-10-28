import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useState } from "react"

type Delivery = { distance_km: number; eta_at: string }

// "2026-10-27T10:09:00.000Z" -> "17:09" theo giờ VN, không phụ thuộc múi giờ của trình duyệt.
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })

const OrderStartDeliveryWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [loading, setLoading] = useState(false)
  // Giữ kết quả vừa nhận từ POST để hiện ETA ngay, không cần tải lại trang.
  const [started, setStarted] = useState<Delivery | null>(null)

  const delivery = started ?? (order.metadata?.delivery as Delivery | undefined)
  const canStart = order.metadata?.stage === "PREPARING" && !delivery

  // Chưa giao và cũng chưa tới bước chuẩn bị xong: không có gì để hiện.
  if (!delivery && !canStart) {
    return null
  }

  const startDelivery = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/admin/orders/${order.id}/start-delivery`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.message ?? "Không bắt đầu giao được")
        return
      }
      setStarted(body.delivery)
      toast.success("Đã bắt đầu giao")
    } catch {
      toast.error("Không kết nối được máy chủ")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container className="flex flex-col gap-y-3 p-6">
      <Heading level="h2">Giao hàng</Heading>
      {delivery ? (
        <Text size="small">
          Dự kiến tới lúc {formatTime(delivery.eta_at)} · còn {delivery.distance_km} km
        </Text>
      ) : (
        <Button onClick={startDelivery} isLoading={loading}>
          Bắt đầu giao
        </Button>
      )}
    </Container>
  )
}

// Zone "order.details.side" (không dùng hậu tố .after).
export const config = defineWidgetConfig({
  zone: "order.details.side",
})

export default OrderStartDeliveryWidget
