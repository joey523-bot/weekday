import { json } from "../../_utils/http.js";
import { clearSessionCookie, deleteSession, requireSession } from "../../_utils/auth.js";

export async function onRequestPost(context) {
  const result = await requireSession(context);
  if (!result.response) await deleteSession(context, result.tokenHash);
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
