import { SOUND_MANIFEST_VERSION } from "../shared/sound-catalog";
import { envInt } from "../shared/time";
import type { CreateSessionResponse } from "../shared/schema";
import type { Env } from "./env";
import { allowSessionCreate } from "./rate-limit";
import { signSessionToken, verifySessionToken } from "./session-token";

const DEV_FALLBACK_SECRET = "ijester-dev-secret-do-not-use-in-production";

function tokenSecret(env: Env): string {
  return env.SESSION_TOKEN_SECRET || DEV_FALLBACK_SECRET;
}

/**
 * Cross-origin callers get rejected before any Durable Object work happens.
 * Same-origin browser requests always carry a matching Origin on POST/DELETE
 * and on WebSocket upgrades; requests without one (curl, health checks) are
 * allowed only for non-mutating routes handled elsewhere.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function createSession(request: Request, env: Env): Promise<Response> {
  if (!originAllowed(request)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const clientKey =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For") ??
    "local";
  if (!allowSessionCreate(clientKey)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const objectId = env.IJESTER_SESSION.newUniqueId();
  const sessionId = objectId.toString();
  const ttlSeconds = envInt(env.SESSION_TTL_SECONDS, 1800);
  const { token, expiresAt } = await signSessionToken(tokenSecret(env), sessionId, ttlSeconds);

  const body: CreateSessionResponse = {
    session_id: sessionId,
    session_token: token,
    websocket_url: `/api/sessions/${sessionId}/ws`,
    expires_at: new Date(expiresAt).toISOString(),
    sound_manifest_version: SOUND_MANIFEST_VERSION,
  };
  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}

async function authorizedStub(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<DurableObjectStub | Response> {
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ?? request.headers.get("X-Session-Token") ?? "";
  if (!(await verifySessionToken(tokenSecret(env), token, sessionId))) {
    return Response.json({ error: "invalid_session_token" }, { status: 401 });
  }
  let objectId: DurableObjectId;
  try {
    objectId = env.IJESTER_SESSION.idFromString(sessionId);
  } catch {
    return Response.json({ error: "invalid_session_id" }, { status: 400 });
  }
  return env.IJESTER_SESSION.get(objectId);
}

export async function connectSession(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }
  if (!originAllowed(request)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const stub = await authorizedStub(request, env, sessionId);
  if (stub instanceof Response) return stub;
  return stub.fetch(request);
}

export async function endSession(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  if (!originAllowed(request)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const stub = await authorizedStub(request, env, sessionId);
  if (stub instanceof Response) return stub;
  return stub.fetch(new Request(new URL("/end", request.url), { method: "POST" }));
}

export function health(env: Env): Response {
  return Response.json({
    ok: true,
    manifest: SOUND_MANIFEST_VERSION,
    classifier: env.DEEPSEEK_API_KEY ? "deepseek" : "heuristic",
    transcription: env.AI && env.TRANSCRIPTION_PROVIDER === "workers-ai" ? "workers-ai" : "mock",
  });
}
