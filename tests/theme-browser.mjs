// Local UI integration test. All APIs are fixtures; no real accounts or push sends.
// Run with WEEKDAY_PLAYWRIGHT_PATH and optionally WEEKDAY_BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE } from '../scripts/config.js';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.WEEKDAY_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
const reminder = (id, title) => ({ id, title, date: '2026-10-03', category: '其他', notes: '本地模拟备注', leadDays: 0, hour: 9, notificationEnabled: false, completed: false, completedAt: '', createdAt: '2026-09-28T00:00:00Z' });
async function scenario(name, run, { loggedIn = true, timezoneId = 'Asia/Shanghai', fixedNow = null, advancingClock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId, serviceWorkers: 'block', reducedMotion: 'reduce' });
  let snapshot = { ...structuredClone(DEFAULT_STATE), reminders: [reminder('r1', '记得带上充电器'), reminder('r2', '取快递')] };
  snapshot.reminders[0].date = '2026-10-20'; snapshot.reminders[1].date = '2026-10-21';
  snapshot.preferences.clockout = {enabled:true, records:{'2026-10-20':'09:06'}};
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
  if (fixedNow) { if (advancingClock) await page.clock.install({time:new Date(fixedNow)}); else await page.clock.setFixedTime(new Date(fixedNow)); }
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
const artifacts = resolve(root, 'output/playwright');
await mkdir(artifacts, { recursive:true });
const tab = (page, name) => page.locator(`[data-tab-button][data-switch-view="${name}"]`).click();
async function appearance(page) {
  await tab(page, 'settings');
  await page.locator('[data-open-dialog="settingsAppearance"]').click();
}
async function closeAppearance(page) {
  await page.locator('#settingsAppearance [data-close-dialog]').click();
}
async function colors(page) {
  return page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return { background:style('body').backgroundColor, salary:style('.salary-snapshot').backgroundImage,
      salaryColor:style('#salaryCountdown').color, clockoutColor:style('[data-digit]').color,
      clockoutBackground:style('[data-digit]').backgroundColor, header:style('.brand').fontSize,
      buttonColor:style('.icon-button').color, buttonBackground:style('.icon-button').backgroundColor,
      navRadius:style('.bottom-tabs').borderRadius, focus:getComputedStyle(document.documentElement).getPropertyValue('--focus-ring') };
  });
}
try {
  browser = await (process.env.WEEKDAY_BROWSER_ENGINE === 'webkit' ? webkit : chromium).launch({headless:true,
    ...(process.env.WEEKDAY_BROWSER_EXECUTABLE ? {executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE} : {})});
  await scenario('optional theme persists; switching back restores existing theme and data', async page => {
    await page.goto(origin);
    await page.locator('[data-digit]').first().waitFor();
    const before = await colors(page);
    const data = await page.evaluate(async () => {
      const {getState} = await import('/scripts/state.js');
      const {salary, reminders} = getState(); return {salary, reminders};
    });
    await page.screenshot({path:resolve(artifacts,'theme-before.png'),fullPage:true});
    await appearance(page);
    const saved = page.waitForResponse(response => response.url().endsWith('/api/account/sync') && response.request().method() === 'PUT');
    await page.locator('[data-theme-option="clear"]').click();
    await saved;
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'clear');
    assert.equal(await page.locator('[data-theme-option="clear"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#customThemeDeleteCurrentButton').isVisible(), false);
    await closeAppearance(page);
    await page.reload();
    await page.locator('[data-digit]').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'clear');
    const clear = await colors(page);
    assert.equal(clear.background, 'rgb(244, 246, 250)');
    assert.equal(clear.salaryColor, 'rgb(40, 103, 223)');
    assert.equal(clear.clockoutBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#f4f6fa');
    await page.screenshot({path:resolve(artifacts,'clear-theme-home.png'),fullPage:true});
    await appearance(page);
    await page.screenshot({path:resolve(artifacts,'clear-theme-picker.png'),fullPage:true});
    for (const theme of ['twinkle','jay','clear','forest']) {
      await page.locator(`[data-theme-option="${theme}"]`).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    }
    await closeAppearance(page); await tab(page, 'overview');
    assert.deepEqual(await colors(page), before);
    assert.deepEqual(await page.evaluate(async () => {
      const {getState} = await import('/scripts/state.js');
      const {salary, reminders} = getState(); return {salary, reminders};
    }), data);
    await appearance(page); await page.locator('[data-theme-option="clear"]').click(); await closeAppearance(page);
    await page.evaluate(async () => {
      const {getState, setWeatherSuccess} = await import('/scripts/state.js');
      const {createRefs, renderOverviewWeather} = await import('/scripts/views/render.js');
      const {renderLifestyle} = await import('/scripts/views/lifestyle.js');
      setWeatherSuccess('上海（本地示例）', {city:'上海（本地示例）', country:'自动定位', timezone:'Asia/Shanghai',
        observedAt:'2026-10-20T15:45', temperature:24, apparentTemperature:25, weatherCode:2,
        isDay:true, uvIndex:3.2, nightCloudCover:45, humidity:65, windSpeed:12, windDirection:120, rainProbability:20,
        dailyForecast:[{date:'2026-10-20',low:18,high:27,uvIndex:6,moonPhase:.68,moonrise:'2026-10-20T20:10',moonset:'2026-10-21T09:20'}],
        hourlyForecast:[], advice:[]});
      renderOverviewWeather(getState(), createRefs(document)); renderLifestyle(getState());
    });
    for (const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      for (const width of [320,375,390,768,1024]) {
        await page.setViewportSize({width,height:844});
        for (const name of ['overview','reminders','weather','settings']) {
          await tab(page, name);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${width}/${colorScheme} overflow`);
          assert.ok(await page.evaluate(() => {
            const content = document.querySelector('.workspace').getBoundingClientRect();
            const nav = document.querySelector('.bottom-tabs').getBoundingClientRect();
            return content.bottom <= nav.top && nav.bottom <= innerHeight;
          }), `${name}/${width}/${colorScheme} navigation overlaps content`);
        }
      }
      assert.equal((await colors(page)).salaryColor, clear.salaryColor);
      assert.equal((await colors(page)).buttonBackground, clear.buttonBackground);
      assert.equal((await colors(page)).buttonColor, clear.buttonColor);
    }
    await page.emulateMedia({colorScheme:'light'});
    await page.setViewportSize({width:390,height:844});
    for (const name of ['overview','reminders','settings','weather']) {
      await tab(page,name);
      await page.screenshot({path:resolve(artifacts,`clear-theme-${name === 'overview' ? 'home' : name}.png`),fullPage:true});
    }
    assert.match(await page.locator('.weather-hero').evaluate(el => getComputedStyle(el).backgroundImage), /52, 117, 217/);
    assert.ok(await page.locator('.outfit-preview img').evaluate(img => img.complete && img.naturalWidth > 0), 'weather illustration loads');
    await page.setViewportSize({width:844,height:390});
    for (const name of ['overview','reminders','weather','settings']) {
      await tab(page,name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} landscape overflow`);
    }
    await page.setViewportSize({width:375,height:812});
    await page.evaluate(() => document.documentElement.style.fontSize='125%');
    for (const name of ['overview','reminders','weather','settings']) {
      await tab(page,name);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} larger text overflow`);
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await page.setViewportSize({width:390,height:844});
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      await tab(page,'settings');
      const last = page.locator('[data-open-dialog="settingsHelp"]');
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.bottom-tabs').getBoundingClientRect().top), 'last setting is above navigation');
      for (const id of ['settingsAccount','settingsReminders','settingsCycle','settingsSalary','clockoutSettings','settingsAppearance','settingsHelp']) {
        await page.locator(`[data-open-dialog="${id}"]`).click();
        const dialog = page.locator(`#${id}`);
        await dialog.waitFor({state:'visible'});
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `${id}/${width} horizontal overflow`);
        if (id === 'clockoutSettings') await dialog.locator('summary').first().click();
        if (id === 'settingsCycle') await dialog.locator('#cycleSettings > summary').click();
        const body = dialog.locator('.lifestyle-dialog-body');
        await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert.ok(await dialog.locator('[data-close-dialog]').isVisible(), `${id}/${width} close remains visible`);
        assert.ok(await body.evaluate(el => {
          const r = el.getBoundingClientRect(), header = el.previousElementSibling.getBoundingClientRect();
          return r.top >= header.bottom - 1 && r.bottom <= innerHeight;
        }), `${id}/${width} body stays below header`);
        await body.evaluate(el => { el.scrollTop = 0; });
        if (width === 390) await page.screenshot({path:resolve(artifacts,`clear-${id}.png`)});
        await dialog.locator('[data-close-dialog]').click();
      }
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.bottom-tabs').evaluate(el => getComputedStyle(el,'::before').transitionDuration), '0s');
    await appearance(page); await closeAppearance(page);
    await tab(page,'overview');
    await page.locator('.salary-snapshot').press('Enter');
    await page.locator('#salaryDetailDialog').waitFor({state:'visible'});
    await page.locator('#salaryDetailDialog [data-close-dialog]').click();
    await page.locator('#homeClockout').click();
    await page.locator('#clockoutDetail').waitFor({state:'visible'});
    await page.locator('#clockoutDetail [data-close-dialog]').click();
    await tab(page,'reminders');
    await page.locator('#reminderList .reminder-item__body').first().click();
    await page.locator('#reminderDetail').waitFor({state:'visible'});
    await page.locator('#reminderDetailClose').click();
    await page.locator('[data-switch-view="compose"]').first().click();
    assert.ok(await page.locator('#reminderTitleInput').isVisible());
  }, { fixedNow:'2026-10-20T15:50:00+08:00' });
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
