import { json, errorJson, readJson } from '../../_utils.js';
import { createPasswordRecord } from '../../_password.js';
import { signJwt } from '../../_jwt.js';

export async function onRequestPost({ env, request }) {
  if (!env.JWT_SECRET) return errorJson('Servern är inte konfigurerad (JWT_SECRET saknas).', 503);

  const body = await readJson(request);
  if (!body || !body.email || !body.email.includes('@')) return errorJson('En giltig e-postadress krävs.');
  if (!body.password || body.password.length < 8) return errorJson('Lösenordet måste vara minst 8 tecken.');

  const email = body.email.trim().toLowerCase();
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) return errorJson('Ett konto med den e-postadressen finns redan.', 409);

  const { hash, salt, iterations } = await createPasswordRecord(body.password);
  const id = 'user_' + crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, iterations, created_at) VALUES (?,?,?,?,?,?)`
  ).bind(id, email, hash, salt, iterations, now).run();

  const token = await signJwt({ sub: id, email }, env.JWT_SECRET);
  return json({ token, email }, 201);
}
