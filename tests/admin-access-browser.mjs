import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {onRequestPost} from '../functions/api/auth/admin-access.js';
import {hashPassword,sha256} from '../functions/_utils/auth.js';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.WEEKDAY_PLAYWRIGHT_PATH||'playwright');
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../cloudflare/migrations/0003-create-account-tables.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../cloudflare/migrations/0011-password-recovery.sql',import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:{changes:stmt.run(...args).changes}})};}});
 db.exec(readFileSync(new URL('../cloudflare/migrations/0012-admin-credentials.sql',import.meta.url),'utf8'));
 return {db,prepare,batch:async statements=>{db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
}


const DB=database(),env={DB,RECOVERY_ADMIN_USER_ID:'admin',RECOVERY_KEY:'ab'.repeat(32)},p=await hashPassword('old');
DB.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','13800000001',p.hash,p.salt,'now','now');
const token='a'.repeat(43);DB.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run('s','admin',await sha256(token),'now','2099-01-01','now');
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/scripts/')){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('..'+req.url,import.meta.url)));return;}if(req.url!='/api/auth/admin-access'){res.end('<html><body>Local WebAuthn verification</body></html>');return;}let body='';for await(const chunk of req)body+=chunk;const r=await onRequestPost({env,request:new Request(origin+req.url,{method:'POST',headers:req.headers,body})});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch(e){res.writeHead(500).end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://localhost:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.WEEKDAY_BROWSER_EXECUTABLE});
try{
 const context=await browser.newContext();await context.addCookies([{name:'yoyuan_session',value:token,url:origin}]);const page=await context.newPage();await page.goto(origin);
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 const result=await page.evaluate(async()=>{
 const api=async body=>{const r=await fetch('/api/auth/admin-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
 const d=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const e=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const serialize=c=>{const r=c.response,o={id:c.id,rawId:e(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response:{clientDataJSON:e(r.clientDataJSON)}};for(const k of ['attestationObject','authenticatorData','signature'])if(r[k])o.response[k]=e(r[k]);if(r.userHandle)o.response.userHandle=e(r.userHandle);if(r.getTransports)o.response.transports=r.getTransports();return o;};
 const reg=await api({action:'register-options',password:'old'});reg.options.challenge=d(reg.options.challenge);reg.options.user.id=d(reg.options.user.id);const created=await navigator.credentials.create({publicKey:reg.options});await api({action:'register-verify',id:reg.id,response:serialize(created)});
 const o=await api({action:'login-options'});o.options.challenge=d(o.options.challenge);for(const k of o.options.allowCredentials)k.id=d(k.id);const signed=await navigator.credentials.get({publicKey:o.options});const response=serialize(signed);await api({action:'login-verify',id:o.id,response});
 let replay=false;try{await api({action:'login-verify',id:o.id,response});}catch{replay=true;}return {replay};
 });assert.equal(result.replay,true);assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM admin_passkeys').get().n,1);console.log('PASS real WebAuthn virtual authenticator registration, signed login, replay rejection');
 await page.evaluate(async()=>{const {createAuthShell}=await import('/scripts/views/shell.js');document.body.innerHTML=createAuthShell();});
 assert.equal(await page.locator('[data-open-recovery]').isVisible(),false);
 await page.evaluate(()=>{document.querySelector('#accountStartForm').hidden=true;document.querySelector('#loginForm').hidden=false;});
 assert.equal(await page.locator('[data-open-recovery]').isVisible(),true);
 const order=await page.evaluate(()=>{const f=document.querySelector('#loginForm');const submit=f.querySelector('[type=submit]');return !!(submit.compareDocumentPosition(f.querySelector('[data-open-recovery]'))&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(submit.compareDocumentPosition(f.querySelector('[data-auth-back]'))&Node.DOCUMENT_POSITION_FOLLOWING);});assert.equal(order,true);
 console.log('PASS first step hides recovery; login places recovery/change-phone after submit');
}finally{await browser.close();server.close();}
