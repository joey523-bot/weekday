import { badRequest, json } from "../../_utils/http.js";
import { createSession, hashPassword, isValidPassword, isValidPhone, normalizePhone } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  if (!context.env.DB) return badRequest("缺少 D1 绑定 DB", 503);
  const body = await context.request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  const password = body?.password;
  if (!isValidPhone(phone)) return badRequest("请输入正确的 11 位手机号");
  if (!isValidPassword(password)) return badRequest("请输入密码");
  if (!isSnapshot(body?.snapshot)) return badRequest("同步数据无效");

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  try {
    const { salt, hash } = await hashPassword(password);
    await context.env.DB.batch([
      context.env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, phone, hash, salt, now, now),
      context.env.DB.prepare("INSERT INTO account_sync (user_id, snapshot_data, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)")
        .bind(userId, JSON.stringify(body.snapshot), now, now)
    ]);
    const cookie = await createSession(context, userId);
    return json({ ok: true, user: { phone } }, { status: 201, headers: { "Set-Cookie": cookie } });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) return badRequest("这个手机号已被使用", 409);
    if (/no such table|no such column/i.test(String(error.message || ""))) {
      return badRequest("账号数据库尚未完成配置，请执行 0003-create-account-tables.sql", 503);
    }
    return badRequest("账号服务暂时不可用，请稍后重试", 503);
  }
}

function isSnapshot(value) {
  try { return Boolean(value && typeof value === "object" && JSON.stringify(value).length <= 256000); } catch { return false; }
}
