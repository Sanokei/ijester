import { IJesterSession } from "../durable-object/ijester-session";
import type { Env } from "./env";
import { connectSession, createSession, endSession, health } from "./routes";
import { isLocalDevRequest, withSecurityHeaders } from "./security-headers";

export { IJesterSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    const asset = await env.ASSETS.fetch(request);
    return withSecurityHeaders(asset, isLocalDevRequest(url));
  },
} satisfies ExportedHandler<Env>;

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    return createSession(request, env);
  }

  const wsMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f]{64})\/ws$/);
  if (request.method === "GET" && wsMatch) {
    return connectSession(request, env, wsMatch[1]!);
  }

  const idMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f]{64})$/);
  if (request.method === "DELETE" && idMatch) {
    return endSession(request, env, idMatch[1]!);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return health(env);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}
