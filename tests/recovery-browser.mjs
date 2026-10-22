import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.WEEKDAY_PLAYWRIGHT_PATH||'playwright');
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../scripts/views/recovery.js',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/**',async route=>{const admin=route.request().url().includes('/admin/');const body=route.request().postDataJSON();const data=admin?(body?{code:'a'.repeat(32),expiresAt:Date.now()+900000}:{requests:[{id:'r',phone:'13800000002',created_at:Date.now()}]}):{message:body.action==='reset'?'密码已重设，请使用新密码登录。':'申请已提交，请联系管理员'};await route.fulfill({json:data});});
 await page.goto(origin);
 await page.setContent('<main><button data-open-recovery>忘记密码</button><button data-recovery-admin hidden>密码找回管理</button></main>');
 await page.evaluate(async(origin)=>{const {setupRecovery}=await import(origin+'/recovery.js');setupRecovery(document.querySelector('main'));},origin);
 await page.getByText('忘记密码',{exact:true}).click();await page.locator('[name=phone]').fill('13800000002');await page.getByText('提交找回申请',{exact:true}).click();await page.getByRole('status').filter({hasText:'申请已提交'}).waitFor();
 await page.locator('[name=code]').fill('a'.repeat(32));await page.locator('[name=password]').fill('new');await page.locator('[name=confirm]').fill('wrong');await page.getByText('重设密码',{exact:true}).click();assert.match(await page.getByRole('status').textContent(),/一致/);
 await page.locator('[name=confirm]').fill('new');await page.getByText('重设密码',{exact:true}).click();await page.getByRole('status').filter({hasText:'密码已重设'}).waitFor();
 await page.getByText('关闭',{exact:true}).click();await page.getByText('密码找回管理',{exact:true}).click();await page.getByText('确认并发放',{exact:true}).waitFor();assert.equal(await page.getByText('确认并发放',{exact:true}).isDisabled(),true);await page.getByRole('checkbox').check();await page.getByText('确认并发放',{exact:true}).click();await page.getByRole('status').filter({hasText:'恢复码：'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS: request, confirmation mismatch, reset success, admin identity checkbox, issue code, mobile width');
}finally{await browser.close();server.close();}
