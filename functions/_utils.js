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

/**
 * Cloudflare Access injects this header once a request has passed an Access
 * policy check. Falls back to a placeholder for local `wrangler pages dev`
 * runs where Access isn't in front of the app.
 */
export function getUserEmail(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || 'okänd användare';
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
