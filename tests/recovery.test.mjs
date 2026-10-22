import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequestPost as recovery} from '../functions/api/auth/recovery.js';
import {onRequestGet as list,onRequestPost as issue} from '../functions/api/admin/recovery.js';
import {crypt} from '../functions/_utils/recovery.js';
import {sha256,hashPassword,verifyPassword} from '../functions/_utils/auth.js';
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../cloudflare/migrations/0003-create-account-tables.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../cloudflare/migrations/0011-password-recovery.sql',import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:{changes:stmt.run(...args).changes}})};}});
 return {db,prepare,batch:async statements=>{db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
test('recovery lifecycle, access control, expiry, replay and preserved data',async()=>{
 const DB=database(),env={DB,RECOVERY_ADMIN_USER_ID:'admin',RECOVERY_KEY:'ab'.repeat(32)};
 const old=await hashPassword('original');
 for(const [id,phone] of [['admin','13800000001'],['user','13800000002']])DB.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,phone,old.hash,old.salt,'now','now');
 DB.db.prepare('INSERT INTO account_sync VALUES(?,?,1,?,?)').run('user','{"keep":true}','now','now');
 const token='a'.repeat(43),other='b'.repeat(43);
 for(const [id,t] of [['admin',token],['user',other]])DB.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run(id,id,await sha256(t),'now','2099-01-01','now');
 const c=(body,session='',origin='https://test.local')=>({env,request:new Request('https://test.local/api/auth/recovery',{method:body?'POST':'GET',headers:{Origin:origin,Cookie:session?`yoyuan_session=${session}`:'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})});
 assert.equal((await list(c())).status,401);assert.equal((await list(c(null,other))).status,403);
 assert.equal((await recovery(c({phone:'13800000002',action:'request'},'','https://evil.local'))).status,403);
 const req={phone:'13800000002',action:'request'};
 assert.equal((await recovery(c(req))).status,200);
 const first=DB.db.prepare('SELECT * FROM password_recovery').get();
 assert.notEqual(first.code_encrypted,first.code_hash);
 const pendingCode=await crypt(c(),first.code_encrypted,true);
 assert.equal((await recovery(c({...req,action:'reset',code:pendingCode,password:'new'}))).status,400);
 await recovery(c(req));assert.equal(DB.db.prepare('SELECT id FROM password_recovery').get().id,first.id);
 const unknown=await (await recovery(c({...req,phone:'13800000003'}))).json();assert.equal(unknown.ok,true);assert.equal(unknown.code,undefined);
 assert.equal((await issue(c({id:first.id,confirmed:true},other))).status,403);
 assert.equal((await issue(c({id:first.id},token))).status,400);
 const issued=await (await issue(c({id:first.id,confirmed:true},token))).json();
 assert.equal(issued.code.length,32);
 const again=await (await issue(c({id:first.id,confirmed:true},token))).json();assert.equal(again.expiresAt,issued.expiresAt);assert.equal(again.code,issued.code);
 assert.equal((await recovery(c({...req,action:'reset',code:'0'.repeat(32),password:'new'}))).status,400);
 DB.db.prepare('UPDATE password_recovery SET expires_at=0').run();
 assert.equal((await recovery(c({...req,action:'reset',code:issued.code,password:'new'}))).status,400);
 DB.db.prepare('UPDATE password_recovery SET expires_at=?').run(Date.now()+900000);
 assert.equal((await recovery(c({...req,action:'reset',code:issued.code,password:'new'}))).status,200);
 assert.equal((await recovery(c({...req,action:'reset',code:issued.code,password:'overwrite'}))).status,400);
 const user=DB.db.prepare("SELECT * FROM users WHERE id='user'").get();assert.equal(await verifyPassword('new',user.password_salt,user.password_hash),true);
 assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='user'").get().n,0);
 assert.equal(DB.db.prepare("SELECT snapshot_data FROM account_sync WHERE user_id='user'").get().snapshot_data,'{"keep":true}');
 assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='admin'").get().n,1);
 assert.equal((await recovery({...c(req),env:{DB}})).status,503);
});
test('phone request limit is enforced atomically',async()=>{
 const DB=database(),env={DB,RECOVERY_ADMIN_USER_ID:'admin',RECOVERY_KEY:'ab'.repeat(32)};
 for(let i=0;i<11;i++){
 const response=await recovery({env,request:new Request('https://test.local/api/auth/recovery',{method:'POST',headers:{Origin:'https://test.local','CF-Connecting-IP':'127.0.0.1'},body:JSON.stringify({action:'request',phone:'13800000002'})})});
 assert.equal(response.status,i<10?200:429);
 }
});
