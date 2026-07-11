import { json, errorJson, readJson, getUserEmail, isMember } from '../../../_utils.js';

// GET /api/workspaces/:id
export async function onRequestGet({ env, params, request }) {
  const email = getUserEmail(request);
  if (!(await isMember(env, params.id, email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);
  const ws = await env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(params.id).first();
  if (!ws) return errorJson('Arbetsrummet hittades inte.', 404);
  return json(ws);
}

// PUT /api/workspaces/:id — update project/customer metadata (Inställningar-vyn)
export async function onRequestPut({ env, params, request }) {
  const email = getUserEmail(request);
  if (!(await isMember(env, params.id, email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);
  const body = await readJson(request);
  if (!body) return errorJson('Ogiltig data.');
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE workspaces SET name=?, customer=?, project=?, consultancy=?, consultant=?, updated_at=? WHERE id=?`
  ).bind(
    body.name || 'Namnlöst arbetsrum', body.customer || '', body.project || '',
    body.consultancy || '', body.consultant || '', now, params.id
  ).run();

  const ws = await env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(params.id).first();
  if (!ws) return errorJson('Arbetsrummet hittades inte.', 404);
  return json(ws);
}

// DELETE /api/workspaces/:id — removes the workspace and all its systems/actions/members
export async function onRequestDelete({ env, params, request }) {
  const email = getUserEmail(request);
  if (!(await isMember(env, params.id, email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);
  await env.DB.prepare(`DELETE FROM systems WHERE workspace_id = ?`).bind(params.id).run();
  await env.DB.prepare(`DELETE FROM action_status WHERE workspace_id = ?`).bind(params.id).run();
  await env.DB.prepare(`DELETE FROM workspace_members WHERE workspace_id = ?`).bind(params.id).run();
  await env.DB.prepare(`DELETE FROM workspaces WHERE id = ?`).bind(params.id).run();
  return json({ deleted: true });
}
