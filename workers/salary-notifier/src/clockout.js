import webpush from 'web-push';
import { clockoutFor, clockDate, normalizeClockout } from '../../../scripts/utils/clockout.js';
export const CLOCKOUT_SELECT = `SELECT user_id, revision, json_extract(snapshot_data,'$.preferences.clockout') AS clockout FROM account_sync`;
export function clockoutCandidate(record,now=new Date()) {
 if(!record)return null;
 let raw;try {raw=typeof record.clockout==='string'?JSON.parse(record.clockout):record.clockout;}catch{return null;}
 const c=normalizeClockout(raw);if(!c.pushEnabled)return null;
 const date=clockDate(now),result=clockoutFor(c,date,now);
 if(result.status!=='due'||now.getTime()-Date.parse(result.dueAt)>=3600000)return null;
 return {...result,date};
}
export async function processClockoutAccount(record,env,now=new Date()) {
 const candidate=clockoutCandidate(record,now);if(!candidate)return;
 const devices=await env.DB.prepare(`SELECT * FROM salary_push_subscriptions WHERE user_id=? AND enabled=1 AND permission='granted'`).bind(record.user_id).all();
 for(const device of devices.results||[]) {
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO clockout_deliveries(user_id,installation_id,day,status,attempted_at)
   SELECT ?,?,?,'claimed',? WHERE EXISTS(SELECT 1 FROM account_sync WHERE user_id=? AND revision=?)`)
   .bind(record.user_id,device.installation_id,candidate.date,now.toISOString(),record.user_id,record.revision).run();
  if(claim.meta.changes!==1)continue;
  const [live,subscription]=await Promise.all([
   env.DB.prepare(`${CLOCKOUT_SELECT} WHERE user_id=?`).bind(record.user_id).first(),
   env.DB.prepare(`SELECT * FROM salary_push_subscriptions WHERE user_id=? AND installation_id=? AND enabled=1 AND permission='granted'`).bind(record.user_id,device.installation_id).first()]);
  const next=clockoutCandidate(live,now);
  if(!subscription||!next||next.dueAt!==candidate.dueAt){await env.DB.prepare(`DELETE FROM clockout_deliveries WHERE user_id=? AND installation_id=? AND day=? AND status='claimed'`).bind(record.user_id,device.installation_id,candidate.date).run();continue;}
  let status='sent';try {await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({title:'可以打卡下班了',body:`今天${next.time}可以打卡下班，记得完成公司考勤。`,tag:`clockout-${candidate.date}`,url:env.APP_URL||'/'}),{TTL:300});}
  catch(error){status='failed-or-unknown';if([404,410].includes(error.statusCode))await env.DB.prepare(`UPDATE salary_push_subscriptions SET enabled=0 WHERE user_id=? AND installation_id=?`).bind(record.user_id,device.installation_id).run();}
  await env.DB.prepare(`UPDATE clockout_deliveries SET status=? WHERE user_id=? AND installation_id=? AND day=?`).bind(status,record.user_id,device.installation_id,candidate.date).run();
 }
}
