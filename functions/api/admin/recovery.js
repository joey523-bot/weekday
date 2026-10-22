import {admin,reply,sameOrigin,crypt,limited} from '../../_utils/recovery.js';
export async function onRequestGet(c){
 const a=await admin(c);if(a.response)return a.response;
 const r=await c.env.DB.prepare(`SELECT r.id,u.username AS phone,r.created_at,r.issued_at,r.expires_at FROM password_recovery r JOIN users u ON u.id=r.user_id WHERE r.consumed_at IS NULL AND r.created_at>? ORDER BY r.created_at DESC LIMIT 100`).bind(Date.now()-7*86400000).all();
 return reply({ok:true,requests:r.results});
}
export async function onRequestPost(c){
 if(!sameOrigin(c))return reply({error:'请求来源无效'},403);
 const a=await admin(c);if(a.response)return a.response;
 if(await limited(c,'recovery-admin:'+a.session.user_id,60))return reply({error:'操作频繁'},429);
 const b=await c.request.json().catch(()=>null);
 if(b?.confirmed!==true)return reply({error:'请先确认已核验申请人身份'},400);
 const now=Date.now();
 const r=await c.env.DB.prepare(`UPDATE password_recovery SET issued_at=COALESCE(issued_at,?),expires_at=COALESCE(expires_at,?),issued_by=? WHERE id=? AND consumed_at IS NULL AND created_at>? AND (expires_at IS NULL OR expires_at>?) RETURNING code_encrypted,expires_at`).bind(now,now+900000,a.session.user_id,b.id||'',now-7*86400000,now).first();
 if(!r)return reply({error:'申请已失效，请让本人重新申请'},409);
 return reply({ok:true,code:await crypt(c,r.code_encrypted,true),expiresAt:r.expires_at});
}
