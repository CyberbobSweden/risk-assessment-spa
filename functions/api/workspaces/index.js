import { json, errorJson, getAuthUser, readJson } from '../../_utils.js';

// GET /api/workspaces — only workspaces the caller is a member of.
export async function onRequestGet({ env, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  const email = user.email;

  const stmt = (email === 'okänd användare')
    ? env.DB.prepare(
        `SELECT id, name, customer, project, consultancy, consultant, created_at, updated_at
         FROM workspaces ORDER BY updated_at DESC`
      )
    : env.DB.prepare(
        `SELECT w.id, w.name, w.customer, w.project, w.consultancy, w.consultant, w.created_at, w.updated_at
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
         WHERE lower(m.email) = lower(?)
         ORDER BY w.updated_at DESC`
      ).bind(email);
  const { results } = await stmt.all();
  return json(results);
}

// POST /api/workspaces — create a new workspace; the creator becomes its first member.
export async function onRequestPost({ env, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  const email = user.email;

  const body = await readJson(request);
  if (!body || !body.name || !body.name.trim()) return errorJson('Namn krävs för arbetsrummet.');

  const id = 'ws_' + crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO workspaces (id, name, customer, project, consultancy, consultant, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.name.trim(), body.customer || '', body.project || '',
    body.consultancy || '', body.consultant || '', email, now, now
  ).run();

  if (email !== 'okänd användare'){
    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, email, added_at) VALUES (?,?,?)`
    ).bind(id, email, now).run();
  }

  return json({
    id, name: body.name.trim(), customer: body.customer || '', project: body.project || '',
    consultancy: body.consultancy || '', consultant: body.consultant || '',
    created_at: now, updated_at: now,
  }, 201);
}
