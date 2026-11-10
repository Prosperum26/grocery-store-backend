import { loadImageUrls } from "../upload-images"

describe("loadImageUrls", () => {
  it("maps every catalog_id in the committed manifest to its original image URL", () => {
    const urls = loadImageUrls()
    expect(urls.size).toBe(1972)
    expect(urls.get("CAT-000001")).toMatch(/^https:\/\/cdnv2\.tgdd\.vn\/.+\.jpg$/)
    // Ảnh nhóm dán thẳng vào xlsx dưới dạng base64 vẫn là một "link" hợp lệ cho thumbnail.
    expect(urls.get("CAT-001852")).toMatch(/^data:image\/webp;base64,/)
  })
})
