// Minimal JWT implementation (HS256) using the Workers runtime's built-in
// Web Crypto API — no external dependency needed. Same mechanism as
// share-your-music: HMAC-SHA256 signed tokens, verified against JWT_SECRET.

function base64url(bytesOrStr) {
  const str = typeof bytesOrStr === 'string' ? btoa(bytesOrStr) : btoa(String.fromCharCode(...bytesOrStr));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecodeToString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}
function base64urlDecodeToBytes(str) {
  const decoded = base64urlDecodeToString(str);
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

/** Signs a payload into a JWT. Adds iat/exp automatically. */
export async function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 24 * 30) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(fullPayload))}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64url(new Uint8Array(sig))}`;
}

/** Verifies signature + expiry. Returns the payload, or null if invalid/expired. */
export async function verifyJwt(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64urlDecodeToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(base64urlDecodeToString(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}
