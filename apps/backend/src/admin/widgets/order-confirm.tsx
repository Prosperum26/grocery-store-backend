import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useState } from "react"

const OrderConfirmWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const prompt = usePrompt()
  const [loading, setLoading] = useState(false)
  // Giữ kết quả vừa xác nhận để đổi nội dung ngay, không cần tải lại trang.
  const [confirmed, setConfirmed] = useState(false)

  // Chỉ đơn đang chờ xác nhận mới có nút; các stage khác không có gì để hiện.
  if (order.metadata?.stage !== "PENDING" && !confirmed) {
    return null
  }

  const confirm = async () => {
    // Sau khi xác nhận khách không tự huỷ được nữa (API huỷ chỉ cho PENDING), nên hỏi lại một lần.
    const ok = await prompt({
      title: "Xác nhận đơn này?",
      description: "Sau khi xác nhận, khách không tự huỷ được đơn nữa.",
      confirmText: "Xác nhận",
      cancelText: "Quay lại",
    })
    if (!ok) {
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/admin/orders/${order.id}/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.message ?? "Không xác nhận được đơn")
        return
      }
      setConfirmed(true)
      toast.success("Đã xác nhận đơn")
    } catch {
      toast.error("Không kết nối được máy chủ")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container className="flex flex-col gap-y-3 p-6">
      <Heading level="h2">Xác nhận đơn</Heading>
      {confirmed ? (
        <Text size="small">Đã xác nhận. Tải lại trang để thấy trạng thái mới.</Text>
      ) : (
        <>
          <Text size="small">Đơn đã thanh toán và đang chờ cửa hàng xác nhận.</Text>
          <Button onClick={confirm} isLoading={loading}>
            Xác nhận đơn
          </Button>
        </>
      )}
    </Container>
  )
}

// Zone "order.details.side" (không dùng hậu tố .after), cùng chỗ với widget giao hàng.
export const config = defineWidgetConfig({
  zone: "order.details.side",
})

export default OrderConfirmWidget
