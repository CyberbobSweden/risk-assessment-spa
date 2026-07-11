import { json, errorJson, getAuthUser, readJson, isMember } from '../../../../_utils.js';

// GET /api/workspaces/:id/members
export async function onRequestGet({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const { results } = await env.DB.prepare(
    `SELECT email, added_at FROM workspace_members WHERE workspace_id = ? ORDER BY added_at ASC`
  ).bind(params.id).all();
  return json(results);
}

// POST /api/workspaces/:id/members — invite someone by email. They must
// register their own account with that same email before they can log in.
export async function onRequestPost({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const body = await readJson(request);
  if (!body || !body.email || !body.email.includes('@')) return errorJson('En giltig e-postadress krävs.');

  const newEmail = body.email.trim().toLowerCase();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_members (workspace_id, email, added_at) VALUES (?,?,?)`
  ).bind(params.id, newEmail, now).run();

  return json({ email: newEmail, added_at: now }, 201);
}

// DELETE /api/workspaces/:id/members — body: { email }
export async function onRequestDelete({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const body = await readJson(request);
  if (!body || !body.email) return errorJson('E-postadress krävs.');

  await env.DB.prepare(
    `DELETE FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)`
  ).bind(params.id, body.email.trim()).run();

  return json({ removed: true });
}
