import type { PredictRequest } from "./reorder"

const TIMEOUT_MS = 3000

/**
 * Gọi model mua lại, trả các mã món theo thứ hạng. Mọi lỗi đều ghi cảnh báo và trả danh sách rỗng:
 * khối gợi ý ẩn đi, không dùng cách chọn khác, và phần còn lại của trang không bị ảnh hưởng.
 */
export async function fetchReorderRanking(
  body: PredictRequest,
  logger: { warn: (message: string) => void }
): Promise<string[]> {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) {
    logger.warn("Reorder model: AI_SERVICE_URL is not set")
    return []
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn(`Reorder model unavailable: HTTP ${res.status}`)
      return []
    }
    const { items } = (await res.json()) as { items?: { product_id?: unknown }[] }
    if (!Array.isArray(items) || items.some((i) => typeof i?.product_id !== "string")) {
      logger.warn("Reorder model unavailable: unexpected response shape")
      return []
    }
    return items.map((i) => i.product_id as string)
  } catch (e) {
    logger.warn(`Reorder model unavailable: ${(e as Error).message}`)
    return []
  }
}
