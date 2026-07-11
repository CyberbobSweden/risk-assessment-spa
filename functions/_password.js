// Password hashing via PBKDF2 (Web Crypto, built into the Workers runtime).
// Same parameters as share-your-music: 100,000 iterations, SHA-256, a unique
// random salt per user. Passwords are never stored or logged in plain text.

const ITERATIONS = 100000;

function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function deriveBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256
  );
  return new Uint8Array(bits);
}

/** Creates a new salted hash for a freshly chosen password (registration). */
export async function createPasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await deriveBits(password, salt, ITERATIONS);
  return { hash: toBase64(hashBytes), salt: toBase64(salt), iterations: ITERATIONS };
}

/** Recomputes the hash with the stored salt/iterations and compares (constant-time). */
export async function verifyPasswordRecord(password, storedHashB64, storedSaltB64, iterations) {
  const salt = fromBase64(storedSaltB64);
  const computed = await deriveBits(password, salt, iterations || ITERATIONS);
  const expected = fromBase64(storedHashB64);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ expected[i];
  return diff === 0;
}
