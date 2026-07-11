// Shared helpers for Pages Functions. Files/folders prefixed with "_" are
// excluded from Cloudflare Pages' file-based routing, so this module is safe
// to import from route handlers without becoming an endpoint itself.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

import { verifyJwt } from './_jwt.js';

/**
 * Resolves the caller's identity from a signed JWT (Authorization: Bearer ...).
 * Returns { id, email } or null if there's no valid session.
 * Falls back to a permissive dev identity when JWT_SECRET isn't configured
 * (local `wrangler pages dev` without secrets set up).
 */
export async function getAuthUser(request, env) {
  if (!env.JWT_SECRET) return { id: 'dev', email: 'okänd användare' };
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.email) return null;
  return { id: payload.sub, email: payload.email };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

/**
 * Checks whether an email is a member of a workspace. When Cloudflare Access
 * isn't in front of the app (e.g. local `wrangler pages dev`), getUserEmail()
 * returns the placeholder below — we allow that case through so local dev
 * keeps working without an Access setup.
 */
export async function isMember(env, workspaceId, email) {
  if (!email || email === 'okänd användare') return true;
  const row = await env.DB.prepare(
    `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)`
  ).bind(workspaceId, email).first();
  return !!row;
}
