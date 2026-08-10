import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, isValidPassword, isValidUsername, normalizeUsername, verifyPassword } from "../functions/_utils/auth.js";

test("normalizes and validates account credentials", () => {
  assert.equal(normalizeUsername("  Week_User  "), "week_user");
  assert.equal(isValidUsername(normalizeUsername("Week_User")), true);
  assert.equal(isValidUsername(normalizeUsername("no")), false);
  assert.equal(isValidUsername(normalizeUsername("name-with-dash")), false);
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
