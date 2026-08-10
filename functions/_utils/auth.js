import { json } from "./http.js";

const SESSION_COOKIE = "yoyuan_session";
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600000;
const encoder = new TextEncoder();

export function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

export function isValidPhone(value) {
  return /^1[3-9][0-9]{9}$/.test(value);
}

export function isValidPassword(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200;
}

export async function hashPassword(password, salt = randomBase64Url(16)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256
  );
  return { salt, hash: toBase64Url(new Uint8Array(bits)) };
}

export async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, String(expectedHash || ""));
}

export async function requireSession(context) {
  if (!context.env.DB) return { response: json({ error: "缺少 D1 绑定 DB" }, { status: 503 }) };
  const token = getCookie(context.request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { response: json({ error: "请先登录" }, { status: 401 }) };
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const session = await context.env.DB.prepare(
    `SELECT s.id, s.user_id, u.username
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  ).bind(tokenHash, now).first();
  if (!session) return { response: json({ error: "登录已过期，请重新登录" }, { status: 401 }) };
  return { session: { ...session, phone: session.username }, tokenHash, token };
}

export async function createSession(context, userId) {
  const token = randomBase64Url(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await context.env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), userId, await sha256(token), now.toISOString(), expiresAt, now.toISOString()).run();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function deleteSession(context, tokenHash) {
  if (tokenHash) await context.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function renewSession(context, tokenHash, token) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await context.env.DB.prepare("UPDATE auth_sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?")
    .bind(expiresAt, new Date().toISOString(), tokenHash).run();
  return sessionCookie(token);
}

export async function loginBlocked(context, phone) {
  const keys = ["phone:" + phone, "ip:" + getClientIp(context.request)];
  const now = Date.now();
  const rows = await context.env.DB.prepare(
    `SELECT key, locked_until FROM auth_rate_limits WHERE key IN (?1, ?2)`
  ).bind(...keys).all();
  return (rows.results || []).some((row) => new Date(row.locked_until || 0).getTime() > now);
}

export async function recordFailedLogin(context, phone) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  for (const key of ["phone:" + phone, "ip:" + getClientIp(context.request)]) {
    const existing = await context.env.DB.prepare("SELECT failures, window_started_at FROM auth_rate_limits WHERE key = ?").bind(key).first();
    const freshWindow = !existing || new Date(existing.window_started_at).getTime() < new Date(windowStart).getTime();
    const failures = freshWindow ? 1 : Number(existing.failures) + 1;
    const lockedUntil = failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : "";
    await context.env.DB.prepare(
      `INSERT INTO auth_rate_limits (key, failures, window_started_at, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`
    ).bind(key, failures, freshWindow ? now.toISOString() : existing.window_started_at, lockedUntil).run();
  }
}

export async function clearFailedLogins(context, phone) {
  await context.env.DB.prepare("DELETE FROM auth_rate_limits WHERE key IN (?1, ?2)")
    .bind("phone:" + phone, "ip:" + getClientIp(context.request)).run();
}

export async function sha256(value) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function getCookie(request, name) {
  const target = `${name}=`;
  return String(request.headers.get("Cookie") || "").split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(target))?.slice(target.length) || "";
}

function getClientIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
}

function randomBase64Url(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return toBase64Url(bytes);
}

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}
