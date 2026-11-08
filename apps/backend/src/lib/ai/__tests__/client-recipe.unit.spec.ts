import { MedusaError } from "@medusajs/framework/utils"
import { AI_RECIPE_NOT_FOUND, AI_UNAVAILABLE, aiAsk, aiRecipe } from "../client"

const DETAIL = {
  recipe: { id: "a", name: "Canh chua" },
  servings: 4,
  complete: true,
  prep_steps: [],
  cooking_steps: ["Nấu"],
  basket: { buy: [], maybe_have: [] },
  not_in_basket: [],
}
const ASK = { answer: "Khoảng 300 kcal (ước tính).", status: "ok", provider: "p", model: "m", latency_ms: 5 }

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const fetchOf = (...script: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const step = script.shift()!
    if (step instanceof Error) throw step
    return step
  }) as unknown as typeof fetch
  return { impl, calls }
}
const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e) => e)
  expect(MedusaError.isMedusaError(error)).toBe(true)
  return (error as MedusaError).code
}

describe("AI service client: recipe and ask", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://ai.test:8100"
    process.env.AI_INTERNAL_KEY = "k"
  })
  afterAll(() => {
    process.env = saved
  })

  it("recipe gọi /api/v1/recipe và trả nguyên chi tiết", async () => {
    const { impl, calls } = fetchOf(reply(DETAIL))
    expect(await aiRecipe({ recipe_id: "a", servings: 2 }, impl)).toEqual(DETAIL)
    expect(calls[0].url).toBe("http://ai.test:8100/api/v1/recipe")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ recipe_id: "a", servings: 2 })
  })

  it("recipe: 404 thành AI_RECIPE_NOT_FOUND, lỗi khác và body sai thành AI_UNAVAILABLE", async () => {
    expect(await codeOf(aiRecipe({ recipe_id: "z" }, fetchOf(reply({ detail: "x" }, 404)).impl))).toBe(AI_RECIPE_NOT_FOUND)
    expect(await codeOf(aiRecipe({ recipe_id: "a" }, fetchOf(reply({}, 500)).impl))).toBe(AI_UNAVAILABLE)
    expect(await codeOf(aiRecipe({ recipe_id: "a" }, fetchOf(reply({ basket: 1 })).impl))).toBe(AI_UNAVAILABLE)
    expect(await codeOf(aiRecipe({ recipe_id: "a" }, fetchOf(new Error("down")).impl))).toBe(AI_UNAVAILABLE)
  })

  it("ask trả câu trả lời, kể cả khi answer là null (mô hình lỗi)", async () => {
    const { impl, calls } = fetchOf(reply(ASK), reply({ ...ASK, answer: null, status: "fallback_timeout" }))
    expect(await aiAsk({ recipe_id: "a", question: "calo?" }, impl)).toEqual(ASK)
    expect((await aiAsk({ recipe_id: "a", question: "calo?" }, impl)).answer).toBeNull()
    expect(calls[0].url).toBe("http://ai.test:8100/api/v1/ask")
  })

  it("ask: 404, lỗi và body sai", async () => {
    expect(await codeOf(aiAsk({ recipe_id: "z", question: "q" }, fetchOf(reply({}, 404)).impl))).toBe(AI_RECIPE_NOT_FOUND)
    expect(await codeOf(aiAsk({ recipe_id: "a", question: "q" }, fetchOf(reply({}, 503)).impl))).toBe(AI_UNAVAILABLE)
    expect(await codeOf(aiAsk({ recipe_id: "a", question: "q" }, fetchOf(reply({ foo: 1 })).impl))).toBe(AI_UNAVAILABLE)
  })
})
