import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {admin,reply,ready,sameOrigin,limited,newCode} from '../../_utils/recovery.js';
import {hashPassword,verifyPassword,sha256,createSession,clearSessionCookie,isValidPassword} from '../../_utils/auth.js';
const enc=b=>btoa(String.fromCharCode(...b));
const dec=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function onRequestPost(c){
 if(!sameOrigin(c))return reply({error:'请求来源无效'},403);
 if(!ready(c))return reply({error:'管理员恢复暂未配置'},503);
 if(await limited(c,'admin-access:'+ (c.request.headers.get('CF-Connecting-IP')||'local'),20))return reply({error:'操作频繁，请稍后重试'},429);
 const b=await c.request.json().catch(()=>null);if(!b)return reply({error:'请求无效'},400);
 const uid=c.env.RECOVERY_ADMIN_USER_ID,origin=new URL(c.request.url).origin,rpID=new URL(origin).hostname;
 const now=Date.now();
 const keys=(await c.env.DB.prepare('SELECT * FROM admin_passkeys WHERE user_id=?').bind(uid).all()).results||[];
 let a;
 if(['register-options','register-verify','emergency-generate','list','remove'].includes(b.action)){
  a=await admin(c);if(a.response)return a.response;
  if(b.action!=='register-verify'&&b.action!=='list'){
   const user=await c.env.DB.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').bind(uid).first();
   if(!user||!await verifyPassword(b.password||'',user.password_salt,user.password_hash))return reply({error:'当前密码错误'},401);
  }
 }
 if(b.action==='list')return reply({ok:true,keys:keys.map(k=>({id:k.id,createdAt:k.created_at})),emergency:await c.env.DB.prepare('SELECT created_at,consumed_at FROM admin_emergency WHERE user_id=?').bind(uid).first()});
 if(b.action==='remove'){await c.env.DB.prepare('DELETE FROM admin_passkeys WHERE id=? AND user_id=?').bind(b.id||'',uid).run();return reply({ok:true});}
 if(b.action==='emergency-generate'){
  const code=newCode()+newCode();await c.env.DB.prepare('INSERT INTO admin_emergency(user_id,code_hash,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at,consumed_at=NULL,redemption=NULL').bind(uid,await sha256(code),now).run();return reply({ok:true,code});
 }
 if(b.action==='emergency-reset'){
  if(typeof b.code!=='string'||!/^[a-f0-9]{64}$/i.test(b.code)||!isValidPassword(b.newPassword))return reply({error:'请输入应急恢复码及新密码'},400);
  const nonce=crypto.randomUUID(),p=await hashPassword(b.newPassword);
  const r=await c.env.DB.batch([
   c.env.DB.prepare('UPDATE admin_emergency SET consumed_at=?,redemption=? WHERE user_id=? AND code_hash=? AND consumed_at IS NULL').bind(now,nonce,uid,await sha256(b.code.toLowerCase())),
   c.env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id IN(SELECT user_id FROM admin_emergency WHERE redemption=?)').bind(p.hash,p.salt,new Date(now).toISOString(),nonce),
   c.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id IN(SELECT user_id FROM admin_emergency WHERE redemption=?)').bind(nonce),
   c.env.DB.prepare('DELETE FROM admin_passkeys WHERE user_id IN(SELECT user_id FROM admin_emergency WHERE redemption=?)').bind(nonce),
   c.env.DB.prepare('DELETE FROM admin_challenges WHERE user_id IN(SELECT user_id FROM admin_emergency WHERE redemption=?)').bind(nonce),
   c.env.DB.prepare('DELETE FROM password_recovery WHERE user_id IN(SELECT user_id FROM admin_emergency WHERE redemption=?)').bind(nonce)
  ]);
  if(!r[0].meta.changes)return reply({error:'应急恢复码无效或已使用'},400);
  const response=reply({ok:true});response.headers.set('Set-Cookie',clearSessionCookie());return response;
 }
 if(b.action==='register-options'||b.action==='login-options'){
  const registering=b.action==='register-options';
  if(registering&&keys.length>=5)return reply({error:'最多保存5个通行密钥，请先移除旧项'},400);
  const options=registering?await generateRegistrationOptions({rpName:'星期',rpID,userID:new TextEncoder().encode(uid),userName:a.session.phone,attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id})),authenticatorSelection:{residentKey:'required',userVerification:'required'}}):await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
  const id=crypto.randomUUID();await c.env.DB.prepare('DELETE FROM admin_challenges WHERE expires_at<=?').bind(now).run();
  await c.env.DB.prepare('INSERT INTO admin_challenges VALUES(?,?,?,?,?,?)').bind(id,uid,options.challenge,registering?'register':'login',now+300000,a?.session.id||null).run();return reply({ok:true,id,options});
 }
 if(b.action==='register-verify'||b.action==='login-verify'){
  const kind=b.action==='register-verify'?'register':'login';
  const challenge=await c.env.DB.prepare('DELETE FROM admin_challenges WHERE id=? AND user_id=? AND kind=? AND expires_at>? RETURNING *').bind(b.id||'',uid,kind,now).first();
  if(!challenge||kind==='register'&&challenge.session_id!==a.session.id)return reply({error:'验证已过期，请重试'},400);
  try{
   if(kind==='register'){
    const v=await verifyRegistrationResponse({response:b.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});if(!v.verified)throw Error();
    const k=v.registrationInfo.credential;
    await c.env.DB.prepare('INSERT INTO admin_passkeys VALUES(?,?,?,?,?,?)').bind(k.id,uid,enc(k.publicKey),k.counter,JSON.stringify(k.transports||[]),now).run();return reply({ok:true});
   }
   const k=keys.find(k=>k.id===b.response?.id);if(!k)throw Error();
   const v=await verifyAuthenticationResponse({response:b.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:k.id,publicKey:dec(k.public_key),counter:k.counter,transports:JSON.parse(k.transports)}});if(!v.verified)throw Error();
   const changed=await c.env.DB.prepare('UPDATE admin_passkeys SET counter=? WHERE id=? AND counter=?').bind(v.authenticationInfo.newCounter,k.id,k.counter).run();if(!changed.meta.changes)throw Error();
   const cookie=await createSession(c,uid),response=reply({ok:true});response.headers.set('Set-Cookie',cookie);return response;
  }catch{return reply({error:'通行密钥验证失败，请重试或使用密码登录'},400);}
 }
 return reply({error:'不支持的操作'},400);
}
