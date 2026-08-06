/**
 * Coarse, best-effort per-isolate rate limiting for session creation. Not a
 * substitute for platform-level protection (WAF rules / Cloudflare rate
 * limiting), but it stops naive loops from allocating Durable Objects.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

const buckets = new Map<string, number[]>();

export function allowSessionCreate(key: string, now = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= MAX_PER_WINDOW) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);

  // Opportunistic cleanup so the map cannot grow unbounded.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }
  return true;
}
