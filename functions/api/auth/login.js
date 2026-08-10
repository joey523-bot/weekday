import { badRequest, json } from "../../_utils/http.js";
import { clearFailedLogins, createSession, isValidPassword, loginBlocked, normalizeUsername, recordFailedLogin, verifyPassword } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  if (!context.env.DB) return badRequest("缺少 D1 绑定 DB", 503);
  const body = await context.request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = body?.password;
  if (!username || !isValidPassword(password)) return badRequest("用户名或密码错误", 401);
  if (await loginBlocked(context, username)) return badRequest("尝试次数过多，请 15 分钟后再试", 429);
  const user = await context.env.DB.prepare("SELECT id, username, password_hash, password_salt FROM users WHERE username = ?").bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    await recordFailedLogin(context, username);
    return badRequest("用户名或密码错误", 401);
  }
  await clearFailedLogins(context, username);
  return json({ ok: true, user: { username: user.username } }, { headers: { "Set-Cookie": await createSession(context, user.id) } });
}
