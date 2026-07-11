import { json, errorJson, getAuthUser, readJson, isMember } from '../../../../_utils.js';

// GET /api/workspaces/:id/action-overrides — map of actionId -> {effect, cost, note}
export async function onRequestGet({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const { results } = await env.DB.prepare(
    `SELECT action_id, effect, cost, note FROM action_overrides WHERE workspace_id = ?`
  ).bind(params.id).all();
  const out = {};
  results.forEach(r => { out[r.action_id] = { effect: r.effect, cost: r.cost, note: r.note || '' }; });
  return json(out);
}

// POST /api/workspaces/:id/action-overrides — body: { actionId, effect, cost, note }
export async function onRequestPost({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const body = await readJson(request);
  if (!body || !body.actionId) return errorJson('actionId krävs.');
  const effect = clampRating(body.effect);
  const cost = clampRating(body.cost);
  const note = (body.note || '').toString().slice(0, 500);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO action_overrides (workspace_id, action_id, effect, cost, note, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(workspace_id, action_id) DO UPDATE SET
       effect=excluded.effect, cost=excluded.cost, note=excluded.note,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).bind(params.id, body.actionId, effect, cost, note, user.email, now).run();

  return json({ actionId: body.actionId, effect, cost, note });
}

function clampRating(n){
  n = parseInt(n, 10);
  if (isNaN(n)) return null;
  return Math.max(1, Math.min(5, n));
}
