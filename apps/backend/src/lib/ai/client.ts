import { MedusaError } from "@medusajs/framework/utils"
import type {
  AiAskRequest,
  AiAskResponse,
  AiCopilotResponse,
  AiRecipeDetail,
  AiRecipeRequest,
  AiSearchRequest,
  AiSearchResponse,
} from "../../types/ai"

// Gọi AI service (docs/contracts/ai-service.md, mục 5). Chỉ làm việc mạng; gắn giá, tồn ở lib/ai/attach-variants.ts.

/** Mã lỗi khi không lấy được câu trả lời nào từ AI service. Route đổi thành 503 (hợp đồng ai-copilot.md, mục 4). */
export const AI_UNAVAILABLE = "AI_UNAVAILABLE"

/** Mã lỗi khi AI service báo không có món với recipe_id đó (404). Route đổi thành 404. */
export const AI_RECIPE_NOT_FOUND = "AI_RECIPE_NOT_FOUND"

type Endpoint = "search" | "copilot" | "recipe" | "ask"

const TIMEOUT_ENV: Record<Endpoint, string> = {
  search: "AI_SEARCH_TIMEOUT_MS",
  copilot: "AI_COPILOT_TIMEOUT_MS",
  recipe: "AI_RECIPE_TIMEOUT_MS",
  ask: "AI_ASK_TIMEOUT_MS",
}
const TIMEOUT_DEFAULT_MS: Record<Endpoint, number> = { search: 3000, copilot: 35000, recipe: 3000, ask: 35000 }

const unavailable = (message: string, cause?: unknown) => {
  const error = new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message, AI_UNAVAILABLE)
  if (cause) {
    ;(error as Error & { cause?: unknown }).cause = cause
  }
  return error
}

/** Đọc cấu hình mỗi lần gọi (không lưu sẵn) để test và đổi .env không cần khởi động lại module. */
function config(endpoint: Endpoint) {
  const timeout = Number(process.env[TIMEOUT_ENV[endpoint]])
  return {
    baseUrl: (process.env.AI_SERVICE_URL || "http://localhost:8100").replace(/\/+$/, ""),
    key: process.env.AI_INTERNAL_KEY || "",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : TIMEOUT_DEFAULT_MS[endpoint],
  }
}

const isSearchResponse = (value: any): value is AiSearchResponse => Array.isArray(value?.results) && typeof value?.accepted === "boolean"

/** POST tới AI service. Mọi lỗi (mạng, quá giờ, khác 2xx, body sai) thành MedusaError mang mã AI_UNAVAILABLE. */
export async function callAiService(
  endpoint: Endpoint,
  body: object,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const { baseUrl, key, timeoutMs } = config(endpoint)
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
    throw unavailable(timedOut ? `AI service ${endpoint} timed out after ${timeoutMs} ms` : `AI service ${endpoint} unreachable`, e)
  }
  if (response.status === 404 && (endpoint === "recipe" || endpoint === "ask")) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Recipe not found", AI_RECIPE_NOT_FOUND)
  }
  if (!response.ok) {
    throw unavailable(`AI service ${endpoint} answered ${response.status}`)
  }
  try {
    return await response.json()
  } catch (e) {
    throw unavailable(`AI service ${endpoint} returned a body that is not JSON`, e)
  }
}

/** /api/v1/search: món và giỏ dựng bằng code, không có lời AI. */
export async function aiSearch(body: AiSearchRequest, fetchImpl: typeof fetch = fetch): Promise<AiSearchResponse> {
  const data = await callAiService("search", body, fetchImpl)
  if (!isSearchResponse(data)) {
    throw unavailable("AI service search returned an unexpected body")
  }
  return data
}

/**
 * /api/v1/copilot. Lỗi hay quá giờ thì thử /search và trả `{ data, ai: null, ai_status: "fallback_error" }`
 * (hợp đồng ai-service.md, mục 5). Cả hai đều lỗi thì ném AI_UNAVAILABLE.
 */
export async function aiCopilot(body: AiSearchRequest, fetchImpl: typeof fetch = fetch): Promise<AiCopilotResponse> {
  const started = Date.now()
  try {
    const answer = await callAiService("copilot", body, fetchImpl)
    if (!isSearchResponse((answer as any)?.data)) {
      throw unavailable("AI service copilot returned an unexpected body")
    }
    return answer as AiCopilotResponse
  } catch (e) {
    if (!MedusaError.isMedusaError(e) || e.code !== AI_UNAVAILABLE) {
      throw e
    }
    const data = await aiSearch(body, fetchImpl)
    return { data, ai: null, ai_status: "fallback_error", latency_ms: Date.now() - started }
  }
}

/** /api/v1/recipe: công thức, các bước và giỏ nguyên liệu theo số người. Không có bản dự phòng: lỗi thì ném AI_UNAVAILABLE. */
export async function aiRecipe(body: AiRecipeRequest, fetchImpl: typeof fetch = fetch): Promise<AiRecipeDetail> {
  const data = await callAiService("recipe", body, fetchImpl)
  if (!Array.isArray((data as any)?.basket?.buy) || typeof (data as any)?.recipe?.id !== "string") {
    throw unavailable("AI service recipe returned an unexpected body")
  }
  return data as AiRecipeDetail
}

/** /api/v1/ask: câu trả lời cho câu khách hỏi thêm. Mô hình lỗi thì AI service vẫn trả 200 với `answer: null`. */
export async function aiAsk(body: AiAskRequest, fetchImpl: typeof fetch = fetch): Promise<AiAskResponse> {
  const data = await callAiService("ask", body, fetchImpl)
  if (typeof (data as any)?.status !== "string" || !("answer" in (data as object))) {
    throw unavailable("AI service ask returned an unexpected body")
  }
  return data as AiAskResponse
}
