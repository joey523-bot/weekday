import { badRequest, json } from "../../_utils/http.js";
import { createSession, hashPassword, isValidPassword, isValidUsername, normalizeUsername } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  if (!context.env.DB) return badRequest("缺少 D1 绑定 DB", 503);
  const body = await context.request.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = body?.password;
  if (!isValidUsername(username)) return badRequest("用户名需为 3–24 位字母、数字或下划线");
  if (!isValidPassword(password)) return badRequest("密码至少需要 12 位");
  if (!isSnapshot(body?.snapshot)) return badRequest("同步数据无效");

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const { salt, hash } = await hashPassword(password);
  try {
    await context.env.DB.batch([
      context.env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, username, hash, salt, now, now),
      context.env.DB.prepare("INSERT INTO account_sync (user_id, snapshot_data, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)")
        .bind(userId, JSON.stringify(body.snapshot), now, now)
    ]);
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) return badRequest("这个用户名已被使用", 409);
    throw error;
  }
  return json({ ok: true, user: { username } }, { status: 201, headers: { "Set-Cookie": await createSession(context, userId) } });
}

function isSnapshot(value) {
  try { return Boolean(value && typeof value === "object" && JSON.stringify(value).length <= 256000); } catch { return false; }
}
