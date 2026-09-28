// Local UI integration test. All APIs are fixtures; no real accounts or push sends.
// Run with WEEKDAY_PLAYWRIGHT_PATH and optionally WEEKDAY_BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE } from '../scripts/config.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WEEKDAY_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
const reminder = (id, title) => ({ id, title, date: '2026-10-03', category: '其他', notes: '本地模拟备注', leadDays: 0, hour: 9, notificationEnabled: true, completed: false, completedAt: '', createdAt: '2026-09-28T00:00:00Z' });
async function scenario(name, run, { loggedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  let snapshot = { ...structuredClone(DEFAULT_STATE), reminders: [reminder('r1', '测试事项一'), reminder('r2', '测试事项二')] };
  let revision = 1, failSave = false, failLoad = false, conflict = false;
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let status = 200, payload = {};
    if (url.pathname === '/api/auth/session') { status = loggedIn ? 200 : 401; payload = { user: { id: 'fixture-user', phone: '10000000000' } }; }
    else if (url.pathname === '/api/auth/identify') payload = { exists: true };
    else if (url.pathname === '/api/auth/login') { loggedIn = true; payload = { user: { id: 'fixture-user', phone: '10000000000' } }; }
    else if (url.pathname === '/api/account/sync') {
      if (route.request().method() === 'PUT') {
        if (failSave) { status = 503; payload = { error: '模拟保存失败' }; }
        else if (conflict) { status = 409; payload = { conflict: true, revision: revision + 1, snapshot }; }
        else { snapshot = route.request().postDataJSON().snapshot; revision++; payload = { revision }; }
      } else if (failLoad) { status = 503; payload = { error: '模拟加载失败' }; }
      else payload = { snapshot, revision };
    } else { status = 503; payload = { error: '模拟环境未启用推送/天气' }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  try {
    await run(page, {
      snapshot: () => snapshot,
      failSave: value => { failSave = value; }, failLoad: value => { failLoad = value; }, conflict: value => { conflict = value; },
      replace: value => { snapshot = value; revision++; }
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${++count}: ${name}`);
  } finally { await context.close(); }
}
const open = async (page, id = 'r1') => { await page.goto(`${origin}/#reminder=${id}`); await page.locator('#reminderDetail[open]').waitFor(); };
const text = (page, selector) => page.locator(selector).textContent();
try {
  browser = await chromium.launch({ headless: true, ...(process.env.WEEKDAY_BROWSER_EXECUTABLE ? { executablePath: process.env.WEEKDAY_BROWSER_EXECUTABLE } : {}) });
  await scenario('cold route, mobile layout, completion persists to account', async (page, api) => {
    await open(page);
    assert.equal(await text(page, '#reminderDetailTitle'), '测试事项一');
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const close = page.locator('#reminderDetailClose');
    assert.equal(await close.getAttribute('aria-label'), '关闭');
    assert.equal(await close.locator('xpath=..').getAttribute('id'), 'reminderDetail');
    const box = await close.boundingBox(), dialogBox = await page.locator('#reminderDetail').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(box.y < dialogBox.y + 20 && box.x + box.width > dialogBox.x + dialogBox.width - 20);
    assert.equal(await close.locator('span').evaluate(el => getComputedStyle(el).borderRadius), '50%');
    assert.equal(await close.locator('svg').count(), 1);
    await page.locator('#reminderDetailTitle').click(); // Show the resting appearance without keyboard focus.
    await page.screenshot({ path: '/tmp/rem001-close-b.png' });
    await page.click('#reminderDetailComplete');
    await page.getByText('事项已完成并同步。', { exact: true }).waitFor();
    assert.equal(api.snapshot().reminders[0].completed, true);
    await page.click('#reminderDetailClose');
    await page.click('[data-filter="completed"]');
    assert.match(await text(page, '#reminderList'), /测试事项一/);
  });
  await scenario('warm hash, repeated same ID, and edit path', async (page, api) => {
    await open(page);
    await page.click('#reminderDetailClose');
    await page.evaluate(() => { location.hash = 'reminder=r2&notification=1'; });
    await page.getByRole('heading', { name: '测试事项二', exact: true }).waitFor();
    await page.click('#reminderDetailClose');
    await page.evaluate(() => { location.hash = 'reminder=r2&notification=2'; });
    await page.locator('#reminderDetail[open]').waitFor();
    await page.click('#reminderDetailEdit');
    assert.equal(await page.inputValue('#reminderTitleInput'), '测试事项二');
    await page.fill('#reminderTitleInput', '更新后的事项');
    await page.locator('.reminder-switch').click();
    assert.equal(await page.isChecked('#reminderNotificationInput'), false);
    const saved = page.waitForResponse(response => response.url().endsWith('/api/account/sync') && response.request().method() === 'PUT' && response.request().postData().includes('更新后的事项'));
    await page.click('#reminderSubmitButton');
    await saved;
    assert.equal(api.snapshot().reminders.find(item => item.id === 'r2').title, '更新后的事项');
    await page.locator('[data-view="reminders"]:visible').waitFor();
    assert.match(await text(page, '#reminderList'), /更新后的事项/);
  });
  await scenario('deleted/other-account ID explicitly falls back to list', async page => {
    await page.goto(`${origin}/#reminder=not-owned`);
    await page.getByText('该事项已删除或当前账号无权访问，请在事项列表中查看其他事项。', { exact: true }).waitFor();
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
    assert.equal(await page.locator('[data-view="reminders"]').isVisible(), true);
  });
  await scenario('login preserves notification destination', async page => {
    await page.goto(`${origin}/#reminder=r2`);
    await page.locator('#accountPhoneInput').waitFor();
    await page.fill('#accountPhoneInput', '13800000000');
    await page.locator('#accountStartForm button[type="submit"]').click();
    await page.fill('#loginPassword', 'fixture-password');
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#reminderDetail[open]').waitFor();
    assert.equal(await text(page, '#reminderDetailTitle'), '测试事项二');
  }, { loggedIn: false });
  await scenario('save failure is honest and retry succeeds', async (page, api) => {
    await open(page); api.failSave(true);
    await page.click('#reminderDetailComplete');
    await page.getByRole('button', { name: '重试同步', exact: true }).waitFor();
    assert.match(await text(page, '#reminderDetailState'), /尚未同步/);
    assert.equal(api.snapshot().reminders[0].completed, false);
    api.failSave(false); await page.click('#reminderDetailComplete');
    await page.getByText('事项已完成并同步。', { exact: true }).waitFor();
    assert.equal(api.snapshot().reminders[0].completed, true);
  });
  await scenario('load failure never shows cached detail or claims deletion', async (page, api) => {
    await open(page); await page.click('#reminderDetailClose'); api.failLoad(true);
    await page.evaluate(() => { location.hash = 'reminder=r1'; });
    await page.getByText(/暂时无法打开提醒事项：模拟加载失败/).waitFor();
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
  });
  await scenario('revision conflict does not overwrite another device', async (page, api) => {
    await open(page); api.conflict(true);
    await page.click('#reminderDetailComplete');
    await page.getByText(/其他设备已更新事项/).waitFor();
    assert.equal(api.snapshot().reminders[0].completed, false);
  });
  await scenario('already completed reminder is readable without duplicate completion', async (page, api) => {
    const saved = api.snapshot(); saved.reminders[0].completed = true; api.replace(saved);
    await open(page);
    assert.equal(await page.locator('#reminderDetailComplete').isDisabled(), true);
    assert.equal(await text(page, '#reminderDetailState'), '该事项已完成。');
  });
  await scenario('offline entry blocks stale details and preserves retry route', async (page) => {
    await open(page); await page.click('#reminderDetailClose');
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
    await page.evaluate(() => { location.hash = 'reminder=r2'; });
    await page.getByText(/当前离线/).waitFor();
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
    assert.match(page.url(), /reminder=r2/);
  });
  await scenario('home card and View share detail; completion persists', async (page, api) => {
    await page.goto(origin);
    await page.locator('#overviewReminderList [data-reminder-detail="r2"] .reminder-item__title').click();
    await page.locator('#reminderDetail[open]').waitFor();
    assert.equal(await text(page, '#reminderDetailTitle'), '测试事项二');
    await page.click('#reminderDetailComplete');
    await page.getByText('事项已完成并同步。', { exact: true }).waitFor();
    assert.equal(api.snapshot().reminders[1].completed, true);
    assert.equal(await page.locator('[data-view="overview"]').isVisible(), true);
    assert.equal(await page.locator('#reminderDetailClose').getAttribute('aria-label'), '关闭');
    await page.click('#reminderDetailClose');
    assert.equal(await page.locator('[data-view="overview"]').isVisible(), true);
    await page.setViewportSize({ width: 1280, height: 900 }); // Existing View control is desktop-only.
    await page.locator('#overviewReminderList [data-action="detail"][data-id="r1"]').click();
    await page.locator('#reminderDetail[open]').waitFor();
    assert.equal(await text(page, '#reminderDetailTitle'), '测试事项一');
    assert.equal(await page.locator('[data-view="overview"]').isVisible(), true);
    await page.click('#reminderDetailEdit');
    assert.equal(await page.locator('[data-view="compose"]').isVisible(), true);
    assert.equal(await page.inputValue('#reminderTitleInput'), '测试事项一');
  });
  await scenario('list keyboard opens correct detail and existing editor', async page => {
    await page.goto(origin);
    await page.locator('[data-tab-button][data-switch-view="reminders"]').click();
    await page.waitForFunction(() => document.activeElement?.matches('[data-view="reminders"] h1'));
    const body = page.locator('#reminderList [data-reminder-detail="r2"] .reminder-item__body');
    await body.focus(); await body.press('Enter');
    await page.locator('#reminderDetail[open]').waitFor();
    assert.equal(await text(page, '#reminderDetailTitle'), '测试事项二');
    await page.click('#reminderDetailClose');
    assert.equal(await page.locator('[data-view="reminders"]').isVisible(), true);
    await page.locator('#reminderList [data-reminder-detail="r2"] .reminder-item__title').click();
    await page.click('#reminderDetailEdit');
    assert.equal(await page.inputValue('#reminderTitleInput'), '测试事项二');
  });
  await scenario('independent edit/complete/restore/delete/export never opens detail', async page => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin);
    await page.locator('[data-tab-button][data-switch-view="reminders"]').click();
    await page.locator('#reminderList [data-action="edit"][data-id="r1"]').click();
    assert.equal(await page.inputValue('#reminderTitleInput'), '测试事项一');
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
    await page.locator('[data-tab-button][data-switch-view="reminders"]').click();
    const download = page.waitForEvent('download');
    await page.locator('#reminderList [data-action="export"][data-id="r1"]').click(); await download;
    await page.locator('#reminderList [data-action="complete"][data-id="r1"]').click();
    await page.click('[data-filter="completed"]');
    await page.locator('#reminderList [data-action="restore"][data-id="r1"]').click();
    await page.click('[data-filter="all"]');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#reminderList [data-action="delete"][data-id="r1"]').click();
    assert.equal(await page.locator('#reminderList [data-reminder-detail="r1"]').count(), 0);
    assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
  });
  for (const surface of ['overviewReminderList', 'reminderList']) {
    await scenario(`${surface} stale/deleted/other-account item falls back safely`, async (page, api) => {
      await page.goto(origin);
      await page.locator('#overviewReminderList [data-reminder-detail="r1"]').waitFor();
      await page.waitForTimeout(1000); // Let startup account synchronization finish before remote deletion.
      const snapshot = api.snapshot(); snapshot.reminders = []; api.replace(snapshot);
      if (surface === 'reminderList') await page.locator('[data-tab-button][data-switch-view="reminders"]').click();
      await page.locator(`#${surface} [data-reminder-detail="r1"] .reminder-item__title`).click();
      await page.getByText('该事项已删除或当前账号无权访问，请在事项列表中查看其他事项。', { exact: true }).waitFor();
      assert.equal(await page.locator('#reminderDetail').evaluate(el => el.open), false);
    });
  }
  console.log(`${count} browser scenarios passed; fixture APIs only.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
