import { json, errorJson, getUserEmail, readJson } from '../../../../_utils.js';

// PUT /api/workspaces/:id/systems/:systemId — update an existing system.
export async function onRequestPut({ env, params, request }) {
  const sys = await readJson(request);
  if (!sys || !sys.name || !sys.type) return errorJson('Systemnamn och typ krävs.');

  const now = new Date().toISOString();
  const email = getUserEmail(request);
  sys.id = params.systemId;
  sys.updatedAt = now;

  const result = await env.DB.prepare(
    `UPDATE systems SET data=?, risk_score=?, risk_level=?, updated_by=?, updated_at=? WHERE id=? AND workspace_id=?`
  ).bind(JSON.stringify(sys), sys.riskScore || 0, sys.riskLevel || 'Låg', email, now, params.systemId, params.id).run();

  if (!result.meta || result.meta.changes === 0) return errorJson('Systemet hittades inte i det här arbetsrummet.', 404);

  await env.DB.prepare(`UPDATE workspaces SET updated_at=? WHERE id=?`).bind(now, params.id).run();
  return json(sys);
}

// DELETE /api/workspaces/:id/systems/:systemId
export async function onRequestDelete({ env, params }) {
  await env.DB.prepare(`DELETE FROM systems WHERE id=? AND workspace_id=?`).bind(params.systemId, params.id).run();
  await env.DB.prepare(`UPDATE workspaces SET updated_at=? WHERE id=?`).bind(new Date().toISOString(), params.id).run();
  return json({ deleted: true });
}
