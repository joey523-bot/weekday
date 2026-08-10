const SNAPSHOT_COLUMNS = ["snapshot_data", "encrypted_data"];

export async function getAccountSnapshotColumn(db) {
  try {
    const result = await db.prepare("PRAGMA table_info(account_sync)").all();
    const columns = (result.results || []).map((entry) => entry.name);
    const snapshotColumn = SNAPSHOT_COLUMNS.find((column) => columns.includes(column));

    if (snapshotColumn) return snapshotColumn;
    throw new Error("账号同步表缺少数据列");
  } catch (error) {
    if (String(error?.message || "").includes("账号同步表")) throw error;
    throw new Error("账号同步表尚未创建");
  }
}

export function accountStorageError(error) {
  const message = String(error?.message || "");
  if (message.includes("账号同步表")) {
    return "账号数据库尚未完成配置：请确认 Cloudflare Pages 绑定的是刚才执行迁移的同一个 D1 数据库，然后只执行 0003-create-account-tables.sql。";
  }
  return "创建账号失败，请稍后再试";
}
