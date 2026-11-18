/**
 * Com4Fud branding for the Medusa Admin, without touching the dashboard's code or layout (Medusa does not allow
 * changing its logo). A small Vite plugin, added through `admin.vite` in medusa-config.ts:
 *  - favicon: the admin page ships an empty placeholder (`<link rel="icon" href="data:,">`); it gets the shop's icon.
 *  - tab title: the dashboard writes "<page> - Medusa" itself (react-helmet, hard-coded); a tiny script rewrites the
 *    suffix to "Com4Fud Admin" whenever the title changes.
 * Texts inside the pages ("Chào mừng đến với Medusa"...) are overridden by translations in src/admin/i18n.
 */
const ICON = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 rx=%2212%22 fill=%22%231F6B3A%22/%3E%3Cg transform=%22translate%285.2 4.2%29 scale%280.8%29%22%3E %3Cg stroke=%22%23FFFFFF%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 fill=%22none%22%3E %3Cpath d=%22M19 16.5l-4 5.5-1 5%22 stroke-width=%224%22/%3E %3Cpath d=%22M18.5 27l-3.5 8-4 7.5%22 stroke-width=%225.2%22/%3E %3Cpath d=%22M18.5 27l3.5 7.5 1.5 8.5%22 stroke-width=%225.2%22/%3E %3Cpath d=%22M20 15l-1.5 12%22 stroke-width=%227.4%22/%3E %3Cpath d=%22M20.5 16.5l4.5 4.5 5 2.5%22 stroke-width=%224%22/%3E %3C/g%3E %3Ccircle cx=%2221%22 cy=%228.2%22 r=%224.8%22 fill=%22%23FFFFFF%22/%3E %3Cpath d=%22M25.6 30.4c-.3-4.4 2.2-6.8 4.4-7.2M38 30.4c.4-4.4-3.4-7-8-7.2%22 stroke=%22%23C8F169%22 stroke-width=%222.2%22 stroke-linecap=%22round%22 fill=%22none%22/%3E %3Cpath d=%22M23.6 30.4h16.6l-1.9 11.4a1.7 1.7 0 0 1-1.7 1.4H27.2a1.7 1.7 0 0 1-1.7-1.4z%22 fill=%22%23C8F169%22/%3E %3Cpath d=%22M23.2 30.1h17.4%22 stroke=%22%23A9D94A%22 stroke-width=%222.6%22 stroke-linecap=%22round%22/%3E %3Cg fill=%22%231F6B3A%22%3E%3Crect x=%2227%22 y=%2233.4%22 width=%221.8%22 height=%225.8%22 rx=%22.9%22/%3E%3Crect x=%2230.3%22 y=%2233.4%22 width=%221.8%22 height=%225.8%22 rx=%22.9%22/%3E%3Crect x=%2233.6%22 y=%2233.4%22 width=%221.8%22 height=%225.8%22 rx=%22.9%22/%3E%3Crect x=%2236.8%22 y=%2233.4%22 width=%221.6%22 height=%225.8%22 rx=%22.8%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"

const TITLE_SCRIPT = `<script>
(function () {
  var fix = function () {
    var t = document.title
    var next = t
    if (t === "Medusa") next = "Com4Fud Admin"
    else if (/ - Medusa$/.test(t)) {
      var page = t.replace(/ - Medusa$/, "")
      next = page.indexOf("Com4Fud") >= 0 ? page : page + " - Com4Fud Admin" // no "Com4Fud Admin - Com4Fud Admin"
    }
    if (next !== t) document.title = next
  }
  new MutationObserver(fix).observe(document.head, { subtree: true, childList: true, characterData: true })
  fix()
})()
</script>`

export function com4fudAdminBrand() {
  return {
    name: "com4fud-admin-brand",
    transformIndexHtml(html: string) {
      return html
        .replace(/<link rel="icon" href="data:,"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${ICON}" />`)
        .replace("</head>", `<title>Com4Fud Admin</title>${TITLE_SCRIPT}</head>`)
    },
  }
}
