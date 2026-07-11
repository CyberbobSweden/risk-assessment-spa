import { json, errorJson, getAuthUser, isMember } from '../../../../_utils.js';

// DELETE /api/workspaces/:id/action-overrides/:actionId — revert to the built-in default.
export async function onRequestDelete({ env, params, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Inloggning krävs.', 401);
  if (!(await isMember(env, params.id, user.email))) return errorJson('Du har inte åtkomst till det här arbetsrummet.', 403);

  await env.DB.prepare(
    `DELETE FROM action_overrides WHERE workspace_id = ? AND action_id = ?`
  ).bind(params.id, params.actionId).run();

  return json({ reset: true });
}
