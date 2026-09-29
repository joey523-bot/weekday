import { requireSession } from "../../_utils/auth.js";
import { json, badRequest } from "../../_utils/http.js";
import { cyclePushSuggestions, CYCLE_ACCOUNT_SELECT, matchingCycle } from "../../_utils/cycle-push.js";
export async function onRequestGet(context) {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id || id.length>100) return badRequest("建议链接无效",400);
  const delivery = await context.env.DB.prepare(`SELECT anchor_tokens FROM cycle_suggestion_deliveries WHERE id=? AND user_id=? AND status IN ('sent','claimed','failed-or-unknown')`)
    .bind(id,auth.session.user_id).first();
  if (!delivery) return badRequest("该建议不存在或不属于当前账号",404);
  const record = await context.env.DB.prepare(`${CYCLE_ACCOUNT_SELECT} WHERE user_id=?`).bind(auth.session.user_id).first();
  const suggestion = matchingCycle(cyclePushSuggestions(record), JSON.parse(delivery.anchor_tokens));
  if (!suggestion) return badRequest("这条建议已处理、已过期或当前不再满足条件",410);
  return json({ok:true,suggestion});
}
