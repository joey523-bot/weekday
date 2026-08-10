import { badRequest, json } from "../../_utils/http.js";
import { requireSession } from "../../_utils/auth.js";
import { accountStorageError, getAccountSnapshotColumn } from "../../_utils/account-storage.js";

const MAX_SNAPSHOT_SIZE = 256000;

export async function onRequestGet(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  try {
    const snapshotColumn = await getAccountSnapshotColumn(context.env.DB);
    const record = await context.env.DB.prepare(`SELECT ${snapshotColumn} AS snapshot_data, revision, updated_at FROM account_sync WHERE user_id = ?`).bind(result.session.user_id).first();
    if (!record) return json({ ok: true, revision: 0, snapshot: null, updatedAt: "" });
    return json({ ok: true, revision: Number(record.revision), snapshot: parseSnapshot(record.snapshot_data), updatedAt: record.updated_at });
  } catch (error) {
    return badRequest(accountStorageError(error), 503);
  }
}

export async function onRequestPut(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  const body = await context.request.json().catch(() => null);
  const revision = Number(body?.baseRevision);
  if (!Number.isInteger(revision) || revision < 1 || !isSnapshot(body?.snapshot)) return badRequest("同步数据无效");
  try {
    const snapshotColumn = await getAccountSnapshotColumn(context.env.DB);
    const now = new Date().toISOString();
    const write = await context.env.DB.prepare(
      `UPDATE account_sync SET ${snapshotColumn} = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?`
    ).bind(JSON.stringify(body.snapshot), now, result.session.user_id, revision).run();
    if (!write.meta.changes) {
      const latest = await context.env.DB.prepare(`SELECT ${snapshotColumn} AS snapshot_data, revision, updated_at FROM account_sync WHERE user_id = ?`).bind(result.session.user_id).first();
      return json({ ok: false, conflict: true, revision: Number(latest.revision), snapshot: parseSnapshot(latest.snapshot_data), updatedAt: latest.updated_at }, { status: 409 });
    }
    return json({ ok: true, revision: revision + 1, updatedAt: now });
  } catch (error) {
    return badRequest(accountStorageError(error), 503);
  }
}

function isSnapshot(value) {
  try { return Boolean(value && typeof value === "object" && JSON.stringify(value).length <= MAX_SNAPSHOT_SIZE); } catch { return false; }
}

function parseSnapshot(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("云端同步数据无效");
  }
}
