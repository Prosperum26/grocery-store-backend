// Bản dịch bổ sung cho Admin (cả chữ "Medusa" người dùng thấy đổi thành Com4Fud), được gộp (deepMerge) vào bản dịch có sẵn của dashboard (verified-apis S6).
// Medusa 2.21.1: vi.json của dashboard thiếu nhóm "layout" (tuỳ chỉnh bố cục trang), nên dù chọn
// Tiếng Việt các nút này vẫn hiện tiếng Anh. Khoá lấy từ en.json của @medusajs/dashboard.
export default {
  en: {
    translation: {
      login: { title: "Welcome to Com4Fud Admin" },
      invite: {
        title: "Welcome to Com4Fud Admin",
        successHint: "Get started with Com4Fud Admin right away.",
        successAction: "Open Com4Fud Admin",
      },
      notifications: { accessibility: { description: "Notifications about Com4Fud activities will be listed here." } },
      translations: { subtitle: "Manage translations of your data in Com4Fud" },
    },
  },
  vi: {
    translation: {
      login: { title: "Chào mừng đến với Com4Fud Admin" },
      invite: {
        title: "Chào mừng đến với Com4Fud Admin",
        successHint: "Bắt đầu ngay với Com4Fud Admin.",
        successAction: "Vào Com4Fud Admin",
      },
      notifications: { accessibility: { description: "Thông báo về các hoạt động của Com4Fud sẽ được liệt kê ở đây." } },
      layout: {
        customizeTopbar: "Tùy chỉnh thanh trên cùng",
        customizeSidebar: "Tùy chỉnh thanh bên",
        customizeSettingsSidebar: "Tùy chỉnh thanh bên Cài đặt",
        customizePage: "Tùy chỉnh trang",
        customizeLayout: "Tùy chỉnh bố cục",
        viewingPersonalLayout: "Bạn đang xem bố cục của riêng bạn",
        viewingSystemLayout: "Bạn đang xem bố cục mặc định",
        personalView: "Của tôi",
        defaultView: "Mặc định",
        empty: "Trống",
        dropToSectionEnd: "Thả vào đây để đưa xuống cuối",
        dragToReorder: "Kéo để đổi thứ tự",
        saveForEveryone: "Lưu cho mọi người",
        saveForEveryoneTitle: "Lưu bố cục cho mọi người",
        saveForEveryoneDescription:
          "Bố cục mặc định của trang này sẽ đổi cho mọi người dùng chưa tự tùy chỉnh. Bạn chắc chứ?",
        saveSuccess: "Đã lưu bố cục",
      },
    },
  },
}
