import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, isValidPassword, isValidPhone, normalizePhone, verifyPassword } from "../functions/_utils/auth.js";
import { getAccountSnapshotColumn } from "../functions/_utils/account-storage.js";

test("normalizes and validates phone account credentials", () => {
  assert.equal(normalizePhone(" 138-0013 8000 "), "13800138000");
  assert.equal(isValidPhone(normalizePhone("13800138000")), true);
  assert.equal(isValidPhone(normalizePhone("12800138000")), false);
  assert.equal(isValidPhone(normalizePhone("1380013800")), false);
  assert.equal(isValidPassword("a secure password"), true);
  assert.equal(isValidPassword("1"), true);
  assert.equal(isValidPassword(""), false);
});

test("password hashes use a unique salt and only verify the original password", async () => {
  const first = await hashPassword("this is a secure password");
  const second = await hashPassword("this is a secure password");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword("this is a secure password", first.salt, first.hash), true);
  assert.equal(await verifyPassword("incorrect password", first.salt, first.hash), false);
});

test("account storage accepts both current and prior snapshot column names", async () => {
  const withColumn = (name) => ({
    prepare: () => ({ all: async () => ({ results: [{ name: "user_id" }, { name }] }) })
  });

  assert.equal(await getAccountSnapshotColumn(withColumn("snapshot_data")), "snapshot_data");
  assert.equal(await getAccountSnapshotColumn(withColumn("encrypted_data")), "encrypted_data");
  await assert.rejects(getAccountSnapshotColumn(withColumn("other_data")), /账号同步表缺少数据列/);
});
