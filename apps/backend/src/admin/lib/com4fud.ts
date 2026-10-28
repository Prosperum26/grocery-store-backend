// Màu thương hiệu Com4Fud dùng trong widget của nhóm (BE-11, phương án A). Admin gốc của Medusa không
// cấu hình được màu, nên chỉ phần do nhóm viết dùng các màu này. Giá trị lấy từ tailwind.config.js của storefront.
// Chỉ dùng cho điểm nhấn (cột biểu đồ, chấm trạng thái); chữ và nền theo theme sáng/tối của Medusa.
export const COM4FUD = {
  brand: "#3C9A5B", // brand.vivid: đọc được trên cả nền sáng và tối
  warn: "#E9A23B", // warn: sắp hết
  sale: "#C8361F", // sale: hết hàng
}

// 395000 -> "395.000đ"
export const formatVnd = (n: number) => `${new Intl.NumberFormat("vi-VN").format(n)}đ`
