import { requireSession, sha256 } from './auth.js';
import { json } from './http.js';
export const reply = (data, status=200) => json(data,{status,headers:{'Cache-Control':'no-store'}});
export function ready(c) { return c.env.DB && c.env.RECOVERY_ADMIN_USER_ID && /^[a-f0-9]{64}$/i.test(c.env.RECOVERY_KEY || ''); }
export function sameOrigin(c) { return c.request.headers.get('Origin') === new URL(c.request.url).origin; }
export async function admin(c) {
 const r=await requireSession(c);
 if(r.response) return {response:r.response};
 if(!ready(c) || r.session.user_id!==c.env.RECOVERY_ADMIN_USER_ID) return {response:reply({error:'无管理权限'},403)};
 return r;
}
export async function limited(c, scope, limit) {
 const key=await sha256(scope), bucket=Math.floor(Date.now()/900000);
 const r=await c.env.DB.prepare(`INSERT INTO recovery_limits(key,bucket,count) VALUES(?,?,1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count`).bind(key,bucket).first();
 return r.count>limit;
}
export async function crypt(c, text, decrypt=false) {
 const raw=Uint8Array.from(c.env.RECOVERY_KEY.match(/../g),x=>parseInt(x,16));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 if(decrypt){const bytes=Uint8Array.from(atob(text),x=>x.charCodeAt(0)); return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)));}
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text)));
 return btoa(String.fromCharCode(...iv,...bytes));
}
export function newCode(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');}
