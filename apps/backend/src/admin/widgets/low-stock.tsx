import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { COM4FUD } from "../lib/com4fud"

type LowStockItem = {
  product_id: string
  title: string
  variant_title: string
  sku: string
  available: number
  low_stock: number
}

const LIMIT = 10

const Th = ({ children, right }: { children: string; right?: boolean }) => (
  <th className={`py-2 ${right ? "text-right" : ""}`}>
    <Text size="small" className="text-ui-fg-subtle">
      {children}
    </Text>
  </th>
)

// Widget "Sắp cạn kho" trên đầu trang Tồn kho: biến thể có tồn khả dụng <= ngưỡng low_stock của sản phẩm,
// ít hàng nhất trước. Cùng quy tắc với nhãn "Còn N" / "Hết hàng" của storefront.
const LowStockWidget = () => {
  const [data, setData] = useState<{ items: LowStockItem[]; count: number } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/admin/dashboard/low-stock?limit=${LIMIT}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  return (
    <Container className="flex flex-col gap-y-3 p-6">
      <Heading level="h2">Sắp cạn kho{data ? ` (${data.count} món)` : ""}</Heading>
      {failed && <Text size="small">Không tải được danh sách sắp cạn kho.</Text>}
      {!failed && !data && (
        <Text size="small" className="text-ui-fg-subtle">
          Đang tải…
        </Text>
      )}
      {data && data.count === 0 && <Text size="small">Không có món nào dưới ngưỡng.</Text>}
      {data && data.count > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ui-border-base">
              <Th>Sản phẩm</Th>
              <Th>Quy cách</Th>
              <Th>SKU</Th>
              <Th right>Còn / ngưỡng</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.sku} className="border-b border-ui-border-base last:border-0">
                <td className="py-2 pr-2">
                  <Text size="small">{item.title}</Text>
                </td>
                <td className="py-2 pr-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {item.variant_title}
                  </Text>
                </td>
                <td className="py-2 pr-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {item.sku}
                  </Text>
                </td>
                <td className="py-2 text-right">
                  <span className="inline-flex items-center gap-x-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ background: item.available === 0 ? COM4FUD.sale : COM4FUD.warn }}
                    />
                    <Text size="small" weight="plus">
                      {item.available === 0 ? "Hết hàng" : `${item.available} / ${item.low_stock}`}
                    </Text>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.count > data.items.length && (
        <Text size="xsmall" className="text-ui-fg-muted">
          Và {data.count - data.items.length} món khác.
        </Text>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "inventory_item.list.before",
})

export default LowStockWidget
