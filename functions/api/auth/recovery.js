import { normalizePhone,isValidPhone,isValidPassword,sha256,hashPassword,clearSessionCookie } from '../../_utils/auth.js';
import {reply,ready,sameOrigin,limited,crypt,newCode} from '../../_utils/recovery.js';
export async function onRequestPost(c){
 if(!sameOrigin(c))return reply({error:'请求来源无效'},403);
 if(!ready(c))return reply({error:'密码找回暂未开放，请联系管理员'},503);
 const b=await c.request.json().catch(()=>null),phone=normalizePhone(b?.phone);
 if(!isValidPhone(phone))return reply({error:'请输入正确手机号'},400);
 const ip=c.request.headers.get('CF-Connecting-IP')||'local';
 if(await limited(c,'recovery-ip:'+ip,30))return reply({error:'操作频繁，请15分钟后重试'},429);
 if(await limited(c,'recovery-phone:'+phone,10))return reply({error:'操作频繁，请15分钟后重试'},429);
 const u=await c.env.DB.prepare('SELECT id FROM users WHERE username=?').bind(phone).first();
 const now=Date.now();
 if(b.action==='request'){
  if(u){
   const code=newCode();
   await c.env.DB.prepare(`INSERT INTO password_recovery(id,user_id,code_hash,code_encrypted,created_at) VALUES(?,?,?,?,?)
   ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,code_encrypted=excluded.code_encrypted,created_at=excluded.created_at,issued_at=NULL,expires_at=NULL,consumed_at=NULL,redemption=NULL,issued_by=NULL
   WHERE password_recovery.consumed_at IS NOT NULL OR (password_recovery.expires_at IS NOT NULL AND password_recovery.expires_at<=?) OR password_recovery.created_at<?`)
   .bind(crypto.randomUUID(),u.id,await sha256(code),await crypt(c,code),now,now,now-7*86400000).run();
  }
  return reply({ok:true,message:'申请已提交，请通过已有联系方式联系管理员核验身份。'});
 }
 if(b.action!=='reset'||!isValidPassword(b.password)||typeof b.code!=='string'||!/^[a-f0-9]{32}$/i.test(b.code))return reply({error:'请填写恢复码及新密码'},400);
 const hash=await sha256(b.code.toLowerCase()),nonce=crypto.randomUUID();
 const password=await hashPassword(b.password);
 // D1 batch is transactional. Claim once, then every mutation is gated by that unique claim.
 const results=await c.env.DB.batch([
 c.env.DB.prepare(`UPDATE password_recovery SET consumed_at=?,redemption=?,code_encrypted='' WHERE user_id=? AND code_hash=? AND issued_at IS NOT NULL AND expires_at>? AND consumed_at IS NULL`).bind(now,nonce,u?.id||'',hash,now),
 c.env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id IN (SELECT user_id FROM password_recovery WHERE redemption=?)`).bind(password.hash,password.salt,new Date(now).toISOString(),nonce),
 c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id IN (SELECT user_id FROM password_recovery WHERE redemption=?)`).bind(nonce)
 ]);
 if(!results[0].meta.changes)return reply({error:'恢复码无效、未发放或已过期'},400);
 const response=reply({ok:true,message:'密码已重设，请使用新密码登录。'});response.headers.set('Set-Cookie',clearSessionCookie());return response;
}
