import assert from "node:assert/strict";
import test from "node:test";

test("salary settings persist through a fresh app-state load", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };

  const firstLoad = await import(`../scripts/state.js?first=${Date.now()}`);
  firstLoad.updateSalary({ day: 10, amount: "15,000 元", account: "工资卡" });

  const secondLoad = await import(`../scripts/state.js?second=${Date.now()}`);
  assert.deepEqual(secondLoad.getState().salary, {
    ...secondLoad.getState().salary,
    day: 10,
    amount: "15,000 元",
    account: "工资卡"
  });
});

test("photo themes can be added, selected, and deleted independently", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };

  const state = await import(`../scripts/state.js?gallery=${Date.now()}`);
  state.addCustomTheme({ imageDataUrl: "data:image/jpeg;base64,one", tone: "light", palette: {}, recommendation: "琥珀暖光" });
  state.addCustomTheme({ imageDataUrl: "data:image/jpeg;base64,two", tone: "dark", palette: {}, recommendation: "深海蓝调" });

  const [first, second] = state.getState().preferences.customThemes;
  assert.equal(state.getState().preferences.activeCustomThemeId, second.id);
  state.selectCustomTheme(first.id);
  assert.equal(state.getState().preferences.activeCustomThemeId, first.id);
  state.deleteCustomTheme(first.id);
  assert.deepEqual(state.getState().preferences.customThemes.map((entry) => entry.id), [second.id]);
  assert.equal(state.getState().preferences.activeCustomThemeId, second.id);
});

test("reminders can be updated without changing their completion history", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };

  const state = await import(`../scripts/state.js?edit=${Date.now()}`);
  state.addReminder({ title: "旧标题", date: "2099-08-10", category: "账单", leadDays: 0, hour: 9, notificationEnabled: true });
  const [reminder] = state.getState().reminders;
  state.setReminderCompletion(reminder.id, true);
  const completedAt = state.getState().reminders[0].completedAt;

  state.updateReminder(reminder.id, { title: "更新后的标题", leadDays: 2, hour: 18, notes: "已修改" });
  assert.deepEqual(state.getState().reminders[0], {
    ...state.getState().reminders[0],
    title: "更新后的标题",
    leadDays: 2,
    hour: 18,
    notes: "已修改",
    completed: true,
    completedAt
  });
});

test("account snapshot includes shared preferences and account clear removes local records", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

  const state = await import(`../scripts/state.js?account=${Date.now()}`);
  state.updateSalary({ amount: "15000", account: "工资卡" });
  state.setNickname("小明");
  state.setTheme("twinkle");
  const snapshot = state.getSyncSnapshot();
  assert.equal(snapshot.preferences.theme, "twinkle");
  assert.equal(snapshot.preferences.nickname, "小明");
  assert.equal(snapshot.salary.amount, "15000");
  state.clearAccountData();
  assert.equal(state.getState().salary.amount, "");
  assert.equal(state.getState().reminders.length, 0);
});
