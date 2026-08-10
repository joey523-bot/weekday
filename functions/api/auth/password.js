import { badRequest, json } from "../../_utils/http.js";
import { hashPassword, isValidPassword, requireSession, verifyPassword } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  const body = await context.request.json().catch(() => null);
  if (!isValidPassword(body?.newPassword)) return badRequest("新密码至少需要 12 位");
  const user = await context.env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(result.session.user_id).first();
  if (!(await verifyPassword(body?.currentPassword || "", user.password_salt, user.password_hash))) return badRequest("当前密码错误", 401);
  const { salt, hash } = await hashPassword(body.newPassword);
  await context.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .bind(hash, salt, new Date().toISOString(), result.session.user_id).run();
  return json({ ok: true });
}
