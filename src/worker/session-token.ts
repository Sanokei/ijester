/**
 * Short-lived signed session credentials: `${sessionId}.${expiresAt}.${sig}`
 * where sig = HMAC-SHA256(secret, `${sessionId}.${expiresAt}`), base64url.
 * Stateless, bound to exactly one Durable Object id.
 */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signSessionToken(
  secret: string,
  sessionId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${sessionId}.${expiresAt}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return { token: `${payload}.${toBase64Url(sig)}`, expiresAt };
}

export async function verifySessionToken(
  secret: string,
  token: string,
  expectedSessionId: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [sessionId, expiresRaw, sig] = parts as [string, string, string];
  if (sessionId !== expectedSessionId) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const key = await hmacKey(secret);
  const payload = `${sessionId}.${expiresAt}`;
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expectedB64 = toBase64Url(expected);

  // Constant-time comparison.
  if (sig.length !== expectedB64.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedB64.charCodeAt(i);
  }
  return diff === 0;
}
