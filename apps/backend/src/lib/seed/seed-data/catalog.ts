// Dữ liệu catalog tạm cho demo (D1). 23 món đầu lấy từ mock Com4Fud_UI_SVG/_source/src/shared.js,
// 9 món sau (đánh dấu "thêm") bổ sung để mỗi danh mục có ít nhất 3 sản phẩm, gồm cả Đồ uống.
// Nhóm sẽ thay bằng dữ liệu thật sau; đổi ở đây rồi chạy lại `npm run seed` (bỏ qua handle đã có).

export type CategoryHandle =
  | "rau-cu"
  | "trai-cay"
  | "thit"
  | "hai-san"
  | "trung-sua"
  | "gao-do-kho"
  | "gia-vi"
  | "do-uong"

export type Tint = "red" | "orange" | "green" | "cream" | "blue" | "yellow" | "brown" | "pink"

export type CatalogVariant = {
  title: string // giá trị của option "Quy cách"
  sku: string
  priceVnd: number // giá niêm yết, số nguyên đồng
  salePriceVnd?: number // có thì vào price list "Khuyến mãi tuần"
  weightGrams: number
  stock: number
  isDefault?: boolean
}

export type CatalogProduct = {
  handle: string
  title: string
  categoryHandle: CategoryHandle
  description: string
  image: string // tên file trong seed-data/images (BE-2b)
  metadata: {
    art?: string
    tint?: Tint
    origin?: string
    stock_unit: string
    low_stock: number
    prep_options?: string[]
    companions?: string[] // handle sản phẩm thường mua kèm
  }
  variants: CatalogVariant[]
}

export const CATEGORIES: { handle: CategoryHandle; name: string }[] = [
  { handle: "rau-cu", name: "Rau củ" },
  { handle: "trai-cay", name: "Trái cây" },
  { handle: "thit", name: "Thịt" },
  { handle: "hai-san", name: "Hải sản" },
  { handle: "trung-sua", name: "Trứng & Sữa" },
  { handle: "gao-do-kho", name: "Gạo & Đồ khô" },
  { handle: "gia-vi", name: "Gia vị" },
  { handle: "do-uong", name: "Đồ uống" },
]

// Sản phẩm một quy cách: biến thể duy nhất là mặc định.
function single(
  p: Omit<CatalogProduct, "variants" | "image" | "description"> & { description?: string },
  v: Omit<CatalogVariant, "isDefault">
): CatalogProduct {
  return {
    ...p,
    description: p.description ?? `${p.title}, giao tươi từ kho Q.7.`,
    image: `${p.handle}.webp`,
    variants: [{ ...v, isDefault: true }],
  }
}

export const CATALOG: CatalogProduct[] = [
  // ---- Rau củ
  single(
    { handle: "ca-chua-da-lat", title: "Cà chua Đà Lạt", categoryHandle: "rau-cu",
      metadata: { art: "tomato", tint: "red", origin: "Đà Lạt", stock_unit: "kg", low_stock: 10, companions: ["hanh-la"] } },
    { title: "1 kg", sku: "RC-0112", priceVnd: 32000, weightGrams: 1000, stock: 86 }),
  single(
    { handle: "rau-muong", title: "Rau muống", categoryHandle: "rau-cu",
      metadata: { art: "waterSpinach", tint: "green", origin: "Củ Chi", stock_unit: "bó", low_stock: 10, companions: ["toi-ly-son"] } },
    { title: "Bó 500g", sku: "RC-0031", priceVnd: 15000, weightGrams: 500, stock: 64 }),
  single(
    { handle: "cai-thia", title: "Cải thìa", categoryHandle: "rau-cu",
      metadata: { art: "bokChoy", tint: "green", origin: "Đà Lạt", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 500g", sku: "RC-0045", priceVnd: 18000, weightGrams: 500, stock: 40 }),
  single(
    { handle: "ca-rot-da-lat", title: "Cà rốt Đà Lạt", categoryHandle: "rau-cu",
      metadata: { art: "carrot", tint: "orange", origin: "Đà Lạt", stock_unit: "kg", low_stock: 10 } },
    { title: "1 kg", sku: "RC-0118", priceVnd: 28000, weightGrams: 1000, stock: 52 }),
  single(
    { handle: "bong-cai-xanh", title: "Bông cải xanh", categoryHandle: "rau-cu",
      metadata: { art: "broccoli", tint: "green", origin: "Đà Lạt", stock_unit: "túi", low_stock: 25 } },
    { title: "Túi 500g", sku: "RC-0150", priceVnd: 42000, salePriceVnd: 35000, weightGrams: 500, stock: 23 }),
  single(
    { handle: "hanh-la", title: "Hành lá", categoryHandle: "rau-cu",
      metadata: { art: "scallion", tint: "green", origin: "Hóc Môn", stock_unit: "bó", low_stock: 10 } },
    { title: "Bó 100g", sku: "RC-0007", priceVnd: 5000, weightGrams: 100, stock: 120 }),
  single(
    { handle: "gia-do", title: "Giá đỗ", categoryHandle: "rau-cu",
      metadata: { art: "sprouts", tint: "cream", origin: "TP.HCM", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 300g", sku: "RC-0009", priceVnd: 6000, weightGrams: 300, stock: 75 }),
  single(
    { handle: "rau-om-ngo-gai", title: "Rau om & ngò gai", categoryHandle: "rau-cu",
      metadata: { art: "herbs", tint: "green", origin: "Củ Chi", stock_unit: "bó", low_stock: 10 } },
    { title: "Bó 100g", sku: "RC-0021", priceVnd: 6000, weightGrams: 100, stock: 48 }),

  // ---- Gia vị
  single(
    { handle: "ot-hiem", title: "Ớt hiểm", categoryHandle: "gia-vi",
      metadata: { art: "chili", tint: "red", origin: "Tiền Giang", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 100g", sku: "GV-0102", priceVnd: 8000, weightGrams: 100, stock: 90 }),
  single(
    { handle: "toi-ly-son", title: "Tỏi Lý Sơn", categoryHandle: "gia-vi",
      metadata: { art: "garlic", tint: "cream", origin: "Lý Sơn", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 200g", sku: "GV-0110", priceVnd: 24000, weightGrams: 200, stock: 33 }),
  single(
    { handle: "gung-ta", title: "Gừng ta", categoryHandle: "gia-vi",
      metadata: { art: "ginger", tint: "yellow", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 200g", sku: "GV-0115", priceVnd: 9000, weightGrams: 200, stock: 41 }),
  single(
    { handle: "me-chua", title: "Me chua", categoryHandle: "gia-vi",
      metadata: { art: "tamarind", tint: "brown", stock_unit: "gói", low_stock: 30 } },
    { title: "Gói 200g", sku: "GV-0131", priceVnd: 12000, weightGrams: 200, stock: 28 }),
  single(
    { handle: "nuoc-mam-ca-com-40n", title: "Nước mắm cá cơm 40°N", categoryHandle: "gia-vi",
      metadata: { art: "fishSauce", tint: "brown", origin: "Phú Quốc", stock_unit: "chai", low_stock: 10 } },
    { title: "Chai 500ml", sku: "GV-0140", priceVnd: 45000, weightGrams: 600, stock: 26 }),

  // ---- Trái cây
  single(
    { handle: "dua-thom-tien-giang", title: "Dứa (thơm) Tiền Giang", categoryHandle: "trai-cay",
      metadata: { art: "pineapple", tint: "yellow", origin: "Tiền Giang", stock_unit: "quả", low_stock: 10 } },
    { title: "1 quả ~1,2 kg", sku: "TC-0204", priceVnd: 20000, weightGrams: 1200, stock: 37 }),
  single(
    { handle: "chuoi-gia-nam-my", title: "Chuối già Nam Mỹ", categoryHandle: "trai-cay",
      metadata: { art: "banana", tint: "yellow", stock_unit: "nải", low_stock: 10 } },
    { title: "Nải ~1 kg", sku: "TC-0210", priceVnd: 25000, weightGrams: 1000, stock: 29 }),
  single( // thêm
    { handle: "cam-sanh", title: "Cam sành", categoryHandle: "trai-cay",
      metadata: { art: "orange", tint: "orange", origin: "Vĩnh Long", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 1 kg", sku: "TC-0215", priceVnd: 35000, weightGrams: 1000, stock: 45 }),

  // ---- Trứng & Sữa (trứng có hai quy cách để kiểm biến thể mặc định)
  {
    handle: "trung-ga-ta",
    title: "Trứng gà ta",
    categoryHandle: "trung-sua",
    description: "Trứng gà ta, giao tươi từ kho Q.7.",
    image: "trung-ga-ta.webp",
    metadata: { art: "eggs", tint: "cream", stock_unit: "hộp", low_stock: 10, companions: ["hanh-la"] },
    variants: [
      { title: "Hộp 10 quả", sku: "TS-0301", priceVnd: 42000, weightGrams: 600, stock: 58, isDefault: true },
      { title: "Hộp 30 quả", sku: "TS-0302", priceVnd: 120000, weightGrams: 1800, stock: 20 },
    ],
  },
  single(
    { handle: "sua-tuoi-khong-duong", title: "Sữa tươi không đường", categoryHandle: "trung-sua",
      metadata: { art: "milk", tint: "blue", stock_unit: "hộp", low_stock: 10 } },
    { title: "Hộp 1 lít", sku: "TS-0322", priceVnd: 38000, weightGrams: 1050, stock: 70 }),
  single( // thêm
    { handle: "sua-chua-co-duong", title: "Sữa chua có đường", categoryHandle: "trung-sua",
      metadata: { art: "yogurt", tint: "blue", stock_unit: "lốc", low_stock: 10 } },
    { title: "Lốc 4 hộp", sku: "TS-0330", priceVnd: 32000, weightGrams: 400, stock: 60 }),

  // ---- Thịt
  single(
    { handle: "uc-ga-phi-le", title: "Ức gà phi lê", categoryHandle: "thit",
      metadata: { art: "chicken", tint: "pink", stock_unit: "khay", low_stock: 10, prep_options: ["Nguyên miếng", "Cắt lát", "Xay"] } },
    { title: "Khay 500g", sku: "TH-0410", priceVnd: 59000, weightGrams: 500, stock: 18 }),
  single(
    { handle: "thit-ba-roi-heo", title: "Thịt ba rọi heo", categoryHandle: "thit",
      metadata: { art: "pork", tint: "pink", stock_unit: "khay", low_stock: 10, prep_options: ["Nguyên miếng", "Cắt lát", "Cắt khúc"], companions: ["nuoc-mam-ca-com-40n"] } },
    { title: "Khay 500g", sku: "TH-0402", priceVnd: 105000, salePriceVnd: 92000, weightGrams: 500, stock: 12 }),
  single( // thêm
    { handle: "suon-non-heo", title: "Sườn non heo", categoryHandle: "thit",
      metadata: { art: "ribs", tint: "pink", stock_unit: "khay", low_stock: 10, prep_options: ["Nguyên miếng", "Chặt miếng"] } },
    { title: "Khay 500g", sku: "TH-0415", priceVnd: 98000, weightGrams: 500, stock: 25 }),

  // ---- Hải sản (cá lóc sắp hết, tôm hết hàng)
  single(
    { handle: "ca-loc-phi-le", title: "Cá lóc phi lê", categoryHandle: "hai-san",
      metadata: { art: "fishFillet", tint: "blue", origin: "Đồng Tháp", stock_unit: "khay", low_stock: 5, prep_options: ["Nguyên miếng", "Cắt lát"] } },
    { title: "Khay 500g", sku: "HS-0507", priceVnd: 85000, weightGrams: 500, stock: 3 }),
  single(
    { handle: "tom-the-tuoi", title: "Tôm thẻ tươi", categoryHandle: "hai-san",
      metadata: { art: "shrimp", tint: "orange", origin: "Cà Mau", stock_unit: "khay", low_stock: 10, prep_options: ["Nguyên con", "Bóc vỏ"] } },
    { title: "Khay 300g", sku: "HS-0512", priceVnd: 99000, weightGrams: 300, stock: 0 }),
  single( // thêm
    { handle: "muc-ong", title: "Mực ống", categoryHandle: "hai-san",
      metadata: { art: "squid", tint: "blue", origin: "Phan Thiết", stock_unit: "khay", low_stock: 10, prep_options: ["Nguyên con", "Cắt khoanh"] } },
    { title: "Khay 300g", sku: "HS-0521", priceVnd: 76000, weightGrams: 300, stock: 30 }),

  // ---- Gạo & Đồ khô (gạo có hai quy cách)
  {
    handle: "gao-st25",
    title: "Gạo ST25",
    categoryHandle: "gao-do-kho",
    description: "Gạo ST25, giao tươi từ kho Q.7.",
    image: "gao-st25.webp",
    metadata: { art: "rice", tint: "cream", origin: "Sóc Trăng", stock_unit: "túi", low_stock: 10 },
    variants: [
      { title: "Túi 5 kg", sku: "GK-0601", priceVnd: 185000, weightGrams: 5000, stock: 44, isDefault: true },
      { title: "Túi 2 kg", sku: "GK-0602", priceVnd: 78000, weightGrams: 2000, stock: 36 },
    ],
  },
  single( // thêm
    { handle: "bun-kho", title: "Bún khô", categoryHandle: "gao-do-kho",
      metadata: { art: "noodles", tint: "cream", stock_unit: "gói", low_stock: 10 } },
    { title: "Gói 300g", sku: "GK-0610", priceVnd: 18000, weightGrams: 300, stock: 80 }),
  single( // thêm
    { handle: "dau-xanh", title: "Đậu xanh", categoryHandle: "gao-do-kho",
      metadata: { art: "beans", tint: "green", stock_unit: "túi", low_stock: 10 } },
    { title: "Túi 500g", sku: "GK-0615", priceVnd: 32000, weightGrams: 500, stock: 55 }),

  // ---- Đồ uống (thêm)
  single(
    { handle: "nuoc-suoi-1-5l", title: "Nước suối 1,5 lít", categoryHandle: "do-uong",
      metadata: { art: "water", tint: "blue", stock_unit: "lốc", low_stock: 10 } },
    { title: "Lốc 6 chai", sku: "DU-0701", priceVnd: 54000, weightGrams: 9200, stock: 40 }),
  single(
    { handle: "tra-xanh-khong-do", title: "Trà xanh không độ", categoryHandle: "do-uong",
      metadata: { art: "tea", tint: "green", stock_unit: "chai", low_stock: 10 } },
    { title: "Chai 455ml", sku: "DU-0702", priceVnd: 12000, weightGrams: 500, stock: 100 }),
  single(
    { handle: "nuoc-cam-ep", title: "Nước cam ép", categoryHandle: "do-uong",
      metadata: { art: "juice", tint: "orange", stock_unit: "chai", low_stock: 10 } },
    { title: "Chai 1 lít", sku: "DU-0703", priceVnd: 45000, salePriceVnd: 38000, weightGrams: 1100, stock: 24 }),
  single(
    { handle: "ca-phe-sua-lon", title: "Cà phê sữa lon", categoryHandle: "do-uong",
      metadata: { art: "coffee", tint: "brown", stock_unit: "lốc", low_stock: 10 } },
    { title: "Lốc 6 lon", sku: "DU-0704", priceVnd: 48000, weightGrams: 1100, stock: 8 }),
]
