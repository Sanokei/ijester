/**
 * Security headers for HTML/asset responses. CSP locks network access to the
 * site's own origin: the browser talks only to our API/WebSocket, never to
 * model or STT providers directly.
 */
export function withSecurityHeaders(response: Response, isDev: boolean): Response {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  if (!isDev) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isLocalDevRequest(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}
