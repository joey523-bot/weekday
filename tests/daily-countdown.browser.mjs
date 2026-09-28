// Local UI smoke test. All account/push requests are fixtures; no real subscription or notification.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium }=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(root)) {res.writeHead(403).end();return;}
  try {const data=await readFile(target);res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.png')?'image/png':'text/html');res.end(data);}
  catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[],registrations=[];let fail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const subscription={endpoint:'https://example.test/push',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'test',auth:'test'}};},async unsubscribe(){return true;}};
    const reg={pushManager:{async getSubscription(){return subscription;}},async update(){},addEventListener(){}};
    Object.defineProperty(navigator,'serviceWorker',{value:{ready:Promise.resolve(reg),async register(){return reg;},addEventListener(){}}});
    Object.defineProperty(Notification,'permission',{get:()=> 'granted'});
    Notification.requestPermission=async()=> 'granted';
    if(!localStorage.getItem('yoyuan-ledger:v2'))localStorage.setItem('yoyuan-ledger:v2',JSON.stringify({salary:{day:5,notification:{enabled:true,hour:9,leadDays:0}}}));
  });
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/push/register') {
      registrations.push(request.postDataJSON());
      return route.fulfill({status:fail?503:200,json:fail?{error:'模拟网络失败'}:{ok:true,publicKey:'test'}});
    }
    return route.fulfill({json:url.pathname==='/api/auth/session'?{user:{id:'test',username:'本地测试'}}:url.pathname==='/api/account/sync'?{snapshot:null,revision:1}:{ok:true,publicKey:'test'}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-tab-button][data-switch-view="settings"]').first().click();
  const toggle=page.locator('#dailyCountdownInput');
  await toggle.waitFor({state:'visible'});
  assert.equal(await toggle.isChecked(),false);
  await toggle.check();await page.waitForFunction(()=>!document.querySelector('#dailyCountdownInput').disabled);
  assert.equal(registrations.at(-1).dailyCountdownEnabled,true);
  assert.equal(registrations.at(-1).reminderHour,9);
  await page.reload();await page.locator('[data-tab-button][data-switch-view="settings"]').first().click();
  assert.equal(await toggle.isChecked(),true);
  await toggle.uncheck();await page.waitForFunction(()=>!document.querySelector('#dailyCountdownInput').disabled);
  assert.equal(registrations.at(-1).dailyCountdownEnabled,false);
  assert.equal(await page.locator('#pushDisableButton').isDisabled(),false);
  fail=true;await toggle.check();await page.waitForFunction(()=>document.querySelector('#pushStatusBadge').textContent==='同步失败');
  assert.match(await page.locator('#pushSyncState').textContent(),/尚未确认生效/);
  fail=false;await page.locator('#pushEnableButton').click();
  // Re-enable requests permission; browser fixture only grants the existing permission.
  await page.waitForFunction(()=>document.querySelector('#pushStatusBadge').textContent==='提醒已同步');
  assert.equal(registrations.at(-1).dailyCountdownEnabled,true);
  await toggle.uncheck();await page.waitForFunction(()=>!document.querySelector('#dailyCountdownInput').disabled);
  if(process.env.PAY_SCREENSHOT)await toggle.locator('xpath=ancestor::article').screenshot({path:process.env.PAY_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('PASS: default off, opt-in payload, reload persistence, independent off, failure visibility, retry, mobile layout (7 checks)');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
