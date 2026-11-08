import { MedusaError } from "@medusajs/framework/utils"
import { AI_UNAVAILABLE, aiCopilot, aiSearch, callAiService } from "../client"

const DATA = { query: "canh chua", servings: 4, accepted: true, threshold: 0.64, results: [] }
const COPILOT = { data: DATA, ai: null, ai_status: "ok", latency_ms: 10 }

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** fetch giả: mỗi lần gọi lấy một bước trong `script` (Response thì trả về, Error thì ném). */
function fakeFetch(script: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const step = script.shift()!
    if (step instanceof Error) {
      throw step
    }
    return step
  }) as unknown as typeof fetch
  return { impl, calls }
}

const expectUnavailable = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e) => e)
  expect(MedusaError.isMedusaError(error)).toBe(true)
  expect((error as MedusaError).code).toBe(AI_UNAVAILABLE)
}

describe("AI service client", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://ai.test:8100/"
    process.env.AI_INTERNAL_KEY = "secret-key"
    delete process.env.AI_SEARCH_TIMEOUT_MS
    delete process.env.AI_COPILOT_TIMEOUT_MS
  })
  afterAll(() => {
    process.env = saved
  })

  it("gọi đúng đường dẫn, gửi khóa nội bộ và body nguyên vẹn", async () => {
    const { impl, calls } = fakeFetch([reply(DATA)])
    await aiSearch({ query: "canh chua", servings: 4, have: ["muối"] }, impl)
    expect(calls[0].url).toBe("http://ai.test:8100/api/v1/search")
    expect((calls[0].init.headers as Record<string, string>)["x-internal-key"]).toBe("secret-key")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ query: "canh chua", servings: 4, have: ["muối"] })
  })

  it("quá giờ mặc định: search 3 giây, copilot 35 giây; đọc từ biến môi trường, giá trị sai thì dùng mặc định", async () => {
    const spy = jest.spyOn(AbortSignal, "timeout")
    const timeoutOf = async (endpoint: "search" | "copilot") => {
      spy.mockClear()
      await callAiService(endpoint, { query: "a" }, fakeFetch([reply({})]).impl)
      return spy.mock.calls[0][0]
    }
    expect(await timeoutOf("search")).toBe(3000)
    expect(await timeoutOf("copilot")).toBe(35000)
    process.env.AI_SEARCH_TIMEOUT_MS = "1500"
    expect(await timeoutOf("search")).toBe(1500)
    process.env.AI_SEARCH_TIMEOUT_MS = "not-a-number"
    expect(await timeoutOf("search")).toBe(3000)
    spy.mockRestore()
  })

  it("mạng lỗi, quá giờ, khác 2xx, body không phải JSON đều thành AI_UNAVAILABLE", async () => {
    const timeout = new Error("slow")
    timeout.name = "TimeoutError"
    await expectUnavailable(callAiService("search", { query: "a" }, fakeFetch([new Error("ECONNREFUSED")]).impl))
    await expectUnavailable(callAiService("search", { query: "a" }, fakeFetch([timeout]).impl))
    await expectUnavailable(callAiService("search", { query: "a" }, fakeFetch([reply({ detail: "no" }, 503)]).impl))
    await expectUnavailable(callAiService("search", { query: "a" }, fakeFetch([new Response("<html>", { status: 200 })]).impl))
  })

  it("body JSON sai hình dạng thì không được tin", async () => {
    await expectUnavailable(aiSearch({ query: "a" }, fakeFetch([reply({ results: "x" })]).impl))
  })

  it("copilot trả nguyên câu trả lời của AI khi mọi thứ ổn", async () => {
    const { impl, calls } = fakeFetch([reply(COPILOT)])
    expect(await aiCopilot({ query: "canh chua" }, impl)).toEqual(COPILOT)
    expect(calls).toHaveLength(1)
  })

  it("copilot lỗi thì dùng /search: có data, ai null, ai_status fallback_error", async () => {
    const { impl, calls } = fakeFetch([reply({ detail: "boom" }, 500), reply(DATA)])
    const out = await aiCopilot({ query: "canh chua" }, impl)
    expect(out).toMatchObject({ data: DATA, ai: null, ai_status: "fallback_error" })
    expect(calls.map((c) => c.url)).toEqual(["http://ai.test:8100/api/v1/copilot", "http://ai.test:8100/api/v1/search"])
  })

  it("copilot trả body thiếu data cũng bị coi là lỗi và dùng /search", async () => {
    const out = await aiCopilot({ query: "a" }, fakeFetch([reply({ ai: null }), reply(DATA)]).impl)
    expect(out.ai_status).toBe("fallback_error")
  })

  it("cả copilot và search đều lỗi thì AI_UNAVAILABLE", async () => {
    await expectUnavailable(aiCopilot({ query: "a" }, fakeFetch([new Error("down"), new Error("down")]).impl))
  })
})
