/** Prefixed, high-entropy ids. Works in browsers, Workers, and Bun. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
