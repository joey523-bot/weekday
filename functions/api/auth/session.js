import { json } from "../../_utils/http.js";
import { renewSession, requireSession } from "../../_utils/auth.js";

export async function onRequestGet(context) {
  const result = await requireSession(context);
  if (result.response) return result.response;
  return json(
    { ok: true, user: { phone: result.session.phone } },
    { headers: { "Set-Cookie": await renewSession(context, result.tokenHash, result.token) } }
  );
}
