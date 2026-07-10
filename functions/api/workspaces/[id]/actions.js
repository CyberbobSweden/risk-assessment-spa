import { json, errorJson, getUserEmail, readJson } from '../../../_utils.js';

// GET /api/workspaces/:id/actions — map of actionId -> completed(bool)
export async function onRequestGet({ env, params }) {
  const { results } = await env.DB.prepare(
    `SELECT action_id, completed FROM action_status WHERE workspace_id = ?`
  ).bind(params.id).all();
  const out = {};
  results.forEach(r => { out[r.action_id] = !!r.completed; });
  return json(out);
}

// POST /api/workspaces/:id/actions — body: { actionId, completed }
export async function onRequestPost({ env, params, request }) {
  const body = await readJson(request);
  if (!body || !body.actionId) return errorJson('actionId krävs.');

  const now = new Date().toISOString();
  const email = getUserEmail(request);
  const completed = body.completed ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO action_status (workspace_id, action_id, completed, updated_by, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(workspace_id, action_id) DO UPDATE SET completed=excluded.completed, updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).bind(params.id, body.actionId, completed, email, now).run();

  return json({ actionId: body.actionId, completed: !!completed });
}
