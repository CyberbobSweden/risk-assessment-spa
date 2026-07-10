import { json, errorJson, getUserEmail, readJson } from '../../_utils.js';

// GET /api/workspaces — list all workspaces the caller can see.
// Cloudflare Access gates who can reach the app at all; if you need stricter
// per-customer isolation later, filter this query by a membership table keyed
// on getUserEmail(request).
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, customer, project, consultancy, consultant, created_at, updated_at
     FROM workspaces ORDER BY updated_at DESC`
  ).all();
  return json(results);
}

// POST /api/workspaces — create a new workspace (one per customer engagement).
export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  if (!body || !body.name || !body.name.trim()) return errorJson('Namn krävs för arbetsrummet.');

  const id = 'ws_' + crypto.randomUUID();
  const now = new Date().toISOString();
  const email = getUserEmail(request);

  await env.DB.prepare(
    `INSERT INTO workspaces (id, name, customer, project, consultancy, consultant, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.name.trim(), body.customer || '', body.project || '',
    body.consultancy || 'Combitech', body.consultant || '', email, now, now
  ).run();

  return json({
    id, name: body.name.trim(), customer: body.customer || '', project: body.project || '',
    consultancy: body.consultancy || 'Combitech', consultant: body.consultant || '',
    created_at: now, updated_at: now,
  }, 201);
}
