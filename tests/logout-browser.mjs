import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WEEKDAY_PLAYWRIGHT_PATH||'playwright');
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../scripts/views/logout.js',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
try{const page=await browser.newPage();await page.goto(origin);await page.setContent('<main></main>');
const open=()=>page.evaluate(async origin=>{const {chooseLogout}=await import(origin+'/logout.js');window.choice=undefined;chooseLogout().then(v=>window.choice=v);},origin);
await open();assert.equal(await page.getByRole('checkbox').isChecked(),false);await page.locator('[data-cancel]').click();await page.waitForFunction(()=>window.choice===null);
await open();await page.locator('[data-confirm]').click();await page.waitForFunction(()=>window.choice?.clearDeviceData===false);
await open();await page.getByRole('checkbox').check();await page.locator('[data-confirm]').click();await page.waitForFunction(()=>window.choice?.clearDeviceData===true);
await open();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.choice===null);
assert.equal(await page.evaluate(async origin=>{const {retainedAccountMatches}=await import(origin+'/logout.js');localStorage.setItem('weekday-retained-account','account-a');return retainedAccountMatches(localStorage,'account-a')&&!retainedAccountMatches(localStorage,'account-b');},origin),true);
console.log('PASS cancel, escape, default keep, explicit clear, owner isolation');
}finally{await browser.close();server.close();}
