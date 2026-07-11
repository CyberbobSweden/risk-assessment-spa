import { json, errorJson, readJson } from '../../_utils.js';
import { verifyPasswordRecord } from '../../_password.js';
import { signJwt } from '../../_jwt.js';

export async function onRequestPost({ env, request }) {
  if (!env.JWT_SECRET) return errorJson('Servern är inte konfigurerad (JWT_SECRET saknas).', 503);

  const body = await readJson(request);
  if (!body || !body.email || !body.password) return errorJson('E-post och lösenord krävs.');

  const email = body.email.trim().toLowerCase();
  const user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user) return errorJson('Fel e-postadress eller lösenord.', 401);

  const ok = await verifyPasswordRecord(body.password, user.password_hash, user.password_salt, user.iterations);
  if (!ok) return errorJson('Fel e-postadress eller lösenord.', 401);

  const token = await signJwt({ sub: user.id, email }, env.JWT_SECRET);
  return json({ token, email });
}
