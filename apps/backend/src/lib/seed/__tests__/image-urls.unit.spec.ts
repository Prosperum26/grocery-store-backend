import { loadImageUrls } from "../upload-images"

describe("loadImageUrls", () => {
  it("maps every catalog_id in the committed manifest to its original image URL", () => {
    const urls = loadImageUrls()
    expect(urls.size).toBe(1746)
    expect(urls.get("CAT-000001")).toMatch(/^https:\/\/cdnv2\.tgdd\.vn\/.+\.jpg$/)
  })
})
