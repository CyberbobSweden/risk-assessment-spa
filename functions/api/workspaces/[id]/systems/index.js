import { json, errorJson, getAuthUser, readJson, isMember } from '../../../../_utils.js';

// GET /api/workspaces/:id/systems — list every system in this workspace.
export async function onRequestGet({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const { results } = await env.DB.prepare(
    `SELECT data FROM systems WHERE workspace_id = ? ORDER BY updated_at DESC`
  ).bind(params.id).all();
  return json(results.map(r => JSON.parse(r.data)));
}

// POST /api/workspaces/:id/systems — create a new system record.
export async function onRequestPost({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  const sys = await readJson(request);
  if (!sys || !sys.name || !sys.type) return errorJson('Systemnamn och typ krävs.');

  const id = sys.id && sys.id.startsWith('sys_') ? sys.id : 'sys_' + crypto.randomUUID();
  const now = new Date().toISOString();
  sys.id = id;
  sys.createdAt = sys.createdAt || now;
  sys.updatedAt = now;

  await env.DB.prepare(
    `INSERT INTO systems (id, workspace_id, data, risk_score, risk_level, created_by, updated_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(id, params.id, JSON.stringify(sys), sys.riskScore || 0, sys.riskLevel || 'Låg', user.email, user.email, sys.createdAt, now).run();

  await touchWorkspace(env, params.id);
  return json(sys, 201);
}

// DELETE /api/workspaces/:id/systems — clear every system in the workspace
// (used by "Radera all data" in Inställningar; the workspace itself remains).
export async function onRequestDelete({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  await env.DB.prepare(`DELETE FROM systems WHERE workspace_id = ?`).bind(params.id).run();
  await env.DB.prepare(`DELETE FROM action_status WHERE workspace_id = ?`).bind(params.id).run();
  await touchWorkspace(env, params.id);
  return json({ cleared: true });
}

async function touchWorkspace(env, workspaceId) {
  await env.DB.prepare(`UPDATE workspaces SET updated_at=? WHERE id=?`).bind(new Date().toISOString(), workspaceId).run();
}
