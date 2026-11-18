import { fetchReorderRanking } from "../ai-client";

const body = { top_k: 10, orders: [] };
const logger = { warn: jest.fn() };
const realFetch = global.fetch;
const realUrl = process.env.AI_SERVICE_URL;
const realReorderUrl = process.env.AI_REORDER_URL;
const realKey = process.env.AI_INTERNAL_KEY;

const respond = (status: number, json: unknown) =>
  jest
    .fn()
    .mockResolvedValue({ ok: status < 300, status, json: async () => json });

describe("fetchReorderRanking", () => {
  beforeEach(() => {
    process.env.AI_SERVICE_URL = "http://ai.test/";
    delete process.env.AI_REORDER_URL;
    process.env.AI_INTERNAL_KEY = "secret-key";
    logger.warn.mockClear();
  });

  afterAll(() => {
    global.fetch = realFetch;
    process.env.AI_SERVICE_URL = realUrl;
    process.env.AI_REORDER_URL = realReorderUrl;
    process.env.AI_INTERNAL_KEY = realKey;
  });

  it("gửi khóa nội bộ, và dùng AI_REORDER_URL khi có", async () => {
    const fetchMock = respond(200, { items: [] });
    global.fetch = fetchMock as any;
    await fetchReorderRanking(body, logger);
    expect(fetchMock.mock.calls[0][1].headers["x-internal-key"]).toBe("secret-key");

    process.env.AI_REORDER_URL = "http://reorder.test:8101";
    await fetchReorderRanking(body, logger);
    expect(fetchMock.mock.calls[1][0]).toBe("http://reorder.test:8101/api/v1/predict");
  });

  it("trả mã món theo thứ hạng của AI", async () => {
    const fetchMock = respond(200, {
      items: [
        { product_id: "b", rank: 1 },
        { product_id: "a", rank: 2 },
      ],
    });
    global.fetch = fetchMock as any;
    await expect(fetchReorderRanking(body, logger)).resolves.toEqual([
      "b",
      "a",
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://ai.test/api/v1/predict");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("thiếu AI_SERVICE_URL thì rỗng, có cảnh báo", async () => {
    delete process.env.AI_SERVICE_URL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    await expect(fetchReorderRanking(body, logger)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("HTTP lỗi thì rỗng, có cảnh báo", async () => {
    global.fetch = respond(503, {
      detail: "reorder model is not loaded",
    }) as any;
    await expect(fetchReorderRanking(body, logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("lỗi mạng hoặc quá thời gian thì rỗng, có cảnh báo", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout")) as any;
    await expect(fetchReorderRanking(body, logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("response sai định dạng thì rỗng, có cảnh báo", async () => {
    global.fetch = respond(200, { items: [{ rank: 1 }] }) as any;
    await expect(fetchReorderRanking(body, logger)).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
