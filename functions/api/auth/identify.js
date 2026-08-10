import { badRequest, json } from "../../_utils/http.js";
import { isValidPhone, normalizePhone } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  if (!context.env.DB) return badRequest("缺少 D1 绑定 DB", 503);
  const body = await context.request.json().catch(() => null);
  const phone = normalizePhone(body?.phone);
  if (!isValidPhone(phone)) return badRequest("请输入正确的 11 位手机号");
  const account = await context.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(phone).first();
  return json({ ok: true, exists: Boolean(account), phone });
}
