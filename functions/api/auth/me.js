import { json, errorJson, getAuthUser } from '../../_utils.js';

export async function onRequestGet({ env, request }) {
  const user = await getAuthUser(request, env);
  if (!user) return errorJson('Ej inloggad.', 401);
  return json({ email: user.email });
}
