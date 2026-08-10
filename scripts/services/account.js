const AUTH_BASE = "/api/auth";
const SYNC_ENDPOINT = "/api/account/sync";

export async function getAccountSession() {
  const response = await fetch(`${AUTH_BASE}/session`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (response.status === 401) return null;
  return readResponse(response);
}

export async function registerAccount({ username, password, snapshot }) {
  return postJson(`${AUTH_BASE}/register`, { username, password, snapshot });
}

export async function loginAccount({ username, password }) {
  return postJson(`${AUTH_BASE}/login`, { username, password });
}

export async function logoutAccount() {
  return postJson(`${AUTH_BASE}/logout`, {});
}

export async function changeAccountPassword({ currentPassword, newPassword }) {
  return postJson(`${AUTH_BASE}/password`, { currentPassword, newPassword });
}

export async function loadAccountSnapshot() {
  const response = await fetch(SYNC_ENDPOINT, { credentials: "same-origin", headers: { Accept: "application/json" } });
  return readResponse(response);
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
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}
