import { badRequest, json } from "../../_utils/http.js";
import { clearFailedLogins, createSession, isValidPassword, isValidPhone, loginBlocked, normalizePhone, recordFailedLogin, verifyPassword } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  if (!context.env.DB) return badRequest("缺少 D1 绑定 DB", 503);
  const body = await context.request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  const password = body?.password;
  if (!isValidPhone(phone) || !isValidPassword(password)) return badRequest("手机号或密码错误", 401);
  if (await loginBlocked(context, phone)) return badRequest("尝试次数过多，请 15 分钟后再试", 429);
  const user = await context.env.DB.prepare("SELECT id, username, password_hash, password_salt FROM users WHERE username = ?").bind(phone).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    await recordFailedLogin(context, phone);
    return badRequest("手机号或密码错误", 401);
  }
  await clearFailedLogins(context, phone);
  return json({ ok: true, user: { phone: user.username } }, { headers: { "Set-Cookie": await createSession(context, user.id) } });
}
