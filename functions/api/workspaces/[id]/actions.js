import { json, errorJson, getAuthUser, readJson, isMember } from '../../../_utils.js';

// GET /api/workspaces/:id/actions — map of actionId -> completed(bool)
export async function onRequestGet({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const { results } = await env.DB.prepare(
    `SELECT action_id, completed FROM action_status WHERE workspace_id = ?`
  ).bind(params.id).all();
  const out = {};
  results.forEach(r => { out[r.action_id] = !!r.completed; });
  return json(out);
}

// POST /api/workspaces/:id/actions — body: { actionId, completed }
export async function onRequestPost({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const body = await readJson(request);
  if (!body || !body.actionId) return errorJson('actionId krävs.');

  const now = new Date().toISOString();
  const completed = body.completed ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO action_status (workspace_id, action_id, completed, updated_by, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(workspace_id, action_id) DO UPDATE SET completed=excluded.completed, updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).bind(params.id, body.actionId, completed, user.email, now).run();

  return json({ actionId: body.actionId, completed: !!completed });
}
