import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequestPost} from '../functions/api/auth/admin-access.js';
import {hashPassword,sha256,verifyPassword} from '../functions/_utils/auth.js';
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../cloudflare/migrations/0003-create-account-tables.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../cloudflare/migrations/0011-password-recovery.sql',import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:{changes:stmt.run(...args).changes}})};}});
 db.exec(readFileSync(new URL('../cloudflare/migrations/0012-admin-credentials.sql',import.meta.url),'utf8'));
 return {db,prepare,batch:async statements=>{db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
}

test('admin emergency credential lifecycle and passkey challenge protections',async()=>{
 const DB=database(),env={DB,RECOVERY_ADMIN_USER_ID:'admin',RECOVERY_KEY:'ab'.repeat(32)},p=await hashPassword('old');
 DB.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','13800000001',p.hash,p.salt,'now','now');
 const token='a'.repeat(43);DB.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run('s','admin',await sha256(token),'now','2099-01-01','now');
 const context=(body,logged=true)=>({env,request:new Request('https://local.test/api/auth/admin-access',{method:'POST',headers:{Origin:'https://local.test',Cookie:logged?'yoyuan_session='+token:'','CF-Connecting-IP':Math.random().toString()},body:JSON.stringify(body)})});
 const call=(body,logged)=>onRequestPost(context(body,logged));
 assert.equal((await call({action:'emergency-generate',password:'old'},false)).status,401);
 assert.equal((await call({action:'emergency-generate',password:'wrong'})).status,401);
 const first=await (await call({action:'emergency-generate',password:'old'})).json();
 const next=await (await call({action:'emergency-generate',password:'old'})).json();assert.notEqual(first.code,next.code);
 assert.equal((await call({action:'emergency-reset',code:first.code,newPassword:'new'},false)).status,400);
 const options=await (await call({action:'register-options',password:'old'})).json();assert.equal(options.options.authenticatorSelection.userVerification,'required');
 assert.equal((await call({action:'register-verify',id:options.id,response:{}})).status,400);
 assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM admin_challenges').get().n,0);
 const listed=await (await call({action:'list'})).json();assert.equal(listed.code,undefined);
 DB.db.prepare('INSERT INTO admin_passkeys VALUES(?,?,?,?,?,?)').run('k','admin','pub',0,'[]',1);
 assert.equal((await call({action:'emergency-reset',code:next.code,newPassword:'new'},false)).status,200);
 assert.equal((await call({action:'emergency-reset',code:next.code,newPassword:'again'},false)).status,400);
 assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM admin_passkeys').get().n,0);
 const u=DB.db.prepare('SELECT * FROM users').get();assert.equal(await verifyPassword('new',u.password_salt,u.password_hash),true);
});
