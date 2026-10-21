// Isolated browsers and fixture APIs only: no production accounts or push sends.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DEFAULT_STATE} from '../scripts/config.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.WEEKDAY_PLAYWRIGHT_PATH||'playwright');
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let snapshot={version:1,capabilities:{repeat:3,notifications:1},salary:{day:15,notification:{leadDays:0,hour:9,dailyCountdownEnabled:false}},reminders:[],preferences:{cycle:{pushEnabled:false}}},revision=1;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/')){
  let payload={},status=200;
  if(path==='/api/auth/session')payload={user:{id:'fixture',phone:'10000000000'}};
  else if(path==='/api/account/sync'){
   if(req.method==='PUT'){let text='';for await(const chunk of req)text+=chunk;const data=JSON.parse(text);
    if(data.baseRevision!==revision){status=409;payload={conflict:true,snapshot,revision};}
    else{snapshot=data.snapshot;revision++;payload={ok:true,revision};}
   }else payload={snapshot,revision};
  }else{status=503;payload={error:'fixture: no real push/weather'};}
  res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(payload));return;
 }
 try{const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const origin='http://127.0.0.1:'+server.address().port;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
 const open=async(viewport)=>{const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'Asia/Shanghai'});const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#pushHourSelect')?.value==='9');await page.click('[data-switch-view="settings"]');await page.click('[data-open-dialog="settingsReminders"]');return{context,page};};
 const a=await open({width:1280,height:900});assert.equal(await a.page.inputValue('#pushHourSelect'),'9');assert.equal(await a.page.isChecked('#dailyCountdownInput'),false);
 const savedHour=a.page.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');await a.page.selectOption('#pushHourSelect','17');await savedHour;
 const saved=a.page.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');await a.page.check('#dailyCountdownInput');await saved;
 assert.equal(snapshot.salary.notification.hour,17);assert.equal(snapshot.salary.notification.dailyCountdownEnabled,true);assert.equal(snapshot.salary.notification.enabled,undefined);assert.equal(snapshot.salary.notification.endpoint,undefined);
 await a.page.reload();await a.page.waitForFunction(()=>document.querySelector('#pushHourSelect')?.value==='17');await a.page.click('[data-switch-view="settings"]');await a.page.click('[data-open-dialog="settingsReminders"]');assert.equal(await a.page.isChecked('#dailyCountdownInput'),true);
 const bContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const b=await bContext.newPage();await b.goto(origin);await b.waitForFunction(()=>document.querySelector('#pushHourSelect')?.value==='17');await b.click('[data-switch-view="settings"]');await b.click('[data-open-dialog="settingsReminders"]');assert.equal(await b.isChecked('#dailyCountdownInput'),true);
 const saveB=b.waitForResponse(r=>r.url().endsWith('/api/account/sync')&&r.request().method()==='PUT');await b.uncheck('#dailyCountdownInput');await saveB;
 await a.page.reload();await a.page.waitForFunction(()=>document.querySelector('#pushHourSelect')?.value==='17');await a.page.click('[data-switch-view="settings"]');await a.page.click('[data-open-dialog="settingsReminders"]');assert.equal(await a.page.isChecked('#dailyCountdownInput'),false);
 assert.match(await a.page.textContent('#dailyCountdownNote'),/账号同步/);
 console.log('PASS: fresh defaults, edit/save/reopen, second-device inheritance, reverse sync; notification permission remains independent.');
 await bContext.close();await a.context.close();
}finally{await browser?.close();await new Promise(r=>server.close(r));}
