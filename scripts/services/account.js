const AUTH_BASE = "/api/auth";
const SYNC_ENDPOINT = "/api/account/sync";

export async function getAccountSession() {
  const response = await fetch(`${AUTH_BASE}/session`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (response.status === 401) return null;
  return readResponse(response);
}

export async function identifyAccount(phone) {
  return postJson(`${AUTH_BASE}/identify`, { phone });
}

export async function registerAccount({ phone, password, snapshot }) {
  return postJson(`${AUTH_BASE}/register`, { phone, password, snapshot });
}

export async function loginAccount({ phone, password }) {
  return postJson(`${AUTH_BASE}/login`, { phone, password });
}

export async function logoutAccount() {
  return postJson(`${AUTH_BASE}/logout`, {});
}

export async function changeAccountPassword({ currentPassword, newPassword }) {
  return postJson(`${AUTH_BASE}/password`, { currentPassword, newPassword });
}

export async function loadAccountSnapshot() {
  const response = await fetch(SYNC_ENDPOINT, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await readResponse(response);
  if (!Number.isInteger(payload?.revision) || payload.revision < 0
      || !Object.hasOwn(payload, "snapshot")
      || (payload.snapshot !== null && !Array.isArray(payload.snapshot?.reminders))
      || (payload.snapshot === null && payload.revision !== 0)) {
    throw new Error("账号同步响应不完整，已保留本机事项，请稍后重试。");
  }
  return payload;
}

export async function saveAccountSnapshot(snapshot, baseRevision) {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "PUT",
    credentials: "same-origin",
    headers: jsonHeaders(),
    body: JSON.stringify({ snapshot, baseRevision })
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409 && payload.conflict) return payload;
  if (!response.ok) throw new Error(payload.error || "同步失败");
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: jsonHeaders(), body: JSON.stringify(body) });
  return readResponse(response);
}

function jsonHeaders() {
  return { "Content-Type": "application/json", Accept: "application/json" };
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 || response.status === 501) {
      throw new Error("当前是静态预览，账号服务没有启动。请使用 Cloudflare Pages 本地服务，或打开已部署的网站。");
    }
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}
