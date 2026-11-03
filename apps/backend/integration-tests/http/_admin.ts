import { Modules } from "@medusajs/framework/utils"
import { createUsersWorkflow } from "@medusajs/medusa/core-flows"

// Tạo user admin trong test, đúng các bước của lệnh `medusa user` (RBAC mặc định tắt nên không gán role):
// tạo user, đăng ký emailpass bằng auth service, gắn app_metadata.user_id vào auth identity,
// rồi đăng nhập để lấy token có actor. Trả về `{ headers }` dùng cho các request /admin.
export async function createAdminHeaders(
  api: { post: (url: string, body: unknown) => Promise<{ data: any }> },
  container: any,
  email = "admin@example.com",
  password = "Passw0rd!"
) {
  const {
    result: [user],
  } = await createUsersWorkflow(container).run({ input: { users: [{ email }] } })

  const authService = container.resolve(Modules.AUTH)
  const { authIdentity, error } = await authService.register("emailpass", { body: { email, password } })
  if (error) {
    throw new Error(`Cannot register admin auth identity: ${error}`)
  }
  await authService.updateAuthIdentities({ id: authIdentity.id, app_metadata: { user_id: user.id } })

  const login = await api.post("/auth/user/emailpass", { email, password })
  return { headers: { authorization: `Bearer ${login.data.token}` } }
}
