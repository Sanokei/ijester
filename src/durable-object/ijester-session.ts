import { DurableObject } from "cloudflare:workers";
import {
  ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type TranscriptSegment,
} from "../shared/schema";
import {
  SOUND_MANIFEST_VERSION,
  activeCatalog,
  parseReactionMode,
  type ReactionMode,
} from "../shared/sound-catalog";
import { envInt } from "../shared/time";
import type { Env } from "../worker/env";
import {
  createReactionModel,
  createTranscriptionProvider,
} from "../providers/factory";
import type { ReactionInput, ReactionModel } from "../providers/reaction-model";
import type { TranscriptionProvider } from "../providers/transcription";
import { PcmAggregator } from "./audio-aggregator";
import { ConversationWindow } from "./conversation-window";
import { LIMITS, serverMessage } from "./protocol";
import {
  evaluateProposal,
  type CueHistoryItem,
  type PolicyContext,
} from "./reaction-policy";
import { transition, type SessionPhase } from "./state-machine";

interface StoredSessionState {
  schemaVersion: 1;
  createdAt: number;
  expiresAt: number;
  mode: ReactionMode;
  paused: boolean;
  muted: boolean;
  recentSegments: TranscriptSegment[];
  summary: string;
  recentCues: CueHistoryItem[];
  nextAllowedCueAt: number;
  lastSequence: number;
  cueCount: number;
  modelCalls: number;
}

interface PendingAudioMeta {
  seq: number;
  mime: string;
  durationMs: number;
  speech: boolean;
  receivedAt: number;
}

/**
 * One page visit = one instance of this object. It owns the visit's
 * WebSocket, transcript window, cooldowns, provider calls, and cleanup.
 * Raw audio only ever lives in request-local memory inside `handleAudio`.
 */
export class IJesterSession extends DurableObject<Env> {
  private phase: SessionPhase = "connecting";
  private window = new ConversationWindow();
  private recentCues: CueHistoryItem[] = [];
  private nextAllowedCueAt = 0;
  private paused = false;
  private muted = false;
  private debug = false;
  private createdAt = Date.now();
  private lastActivityAt = Date.now();
  private lastSequence = -1;
  private cueCount = 0;
  private modelCalls = 0;
  private bytesThisMinute = 0;
  private minuteWindowStart = Date.now();
  private pendingMeta: PendingAudioMeta | null = null;
  private pcm = new PcmAggregator();
  private lastEvalAt = 0;
  private evalEpoch = 0;
  private inflightEval: AbortController | null = null;
  /** Wall-clock time a deferred evaluation is owed, 0 when none. */
  private evalDueAt = 0;
  private mode: ReactionMode;
  private stt: TranscriptionProvider;
  private model: ReactionModel;
  private readonly ttlMs: number;
  private readonly maxSessionMs: number;
  private readonly minEvalIntervalMs: number;
  private readonly maxAudioBytesPerMinute: number;
  private hydrated = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.mode = parseReactionMode(env.REACTION_MODE);
    this.stt = createTranscriptionProvider(env);
    this.model = createReactionModel(env);
    this.ttlMs = envInt(env.SESSION_TTL_SECONDS, 1800) * 1000;
    this.maxSessionMs = envInt(env.MAX_SESSION_SECONDS, 14400) * 1000;
    this.minEvalIntervalMs = envInt(env.REACTION_MIN_INTERVAL_MS, 2500);
    this.maxAudioBytesPerMinute = envInt(env.MAX_AUDIO_BYTES_PER_MINUTE, 2_500_000);
    // Answer keepalive pings without waking from hibernation.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void this.ctx.blockConcurrencyWhile(() => this.hydrate());
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const stored = await this.ctx.storage.get<StoredSessionState>("state");
    if (stored) {
      this.createdAt = stored.createdAt;
      this.mode = stored.mode;
      this.paused = stored.paused;
      this.muted = stored.muted;
      this.window = ConversationWindow.hydrate({
        segments: stored.recentSegments,
        summary: stored.summary,
      });
      this.recentCues = stored.recentCues;
      this.nextAllowedCueAt = stored.nextAllowedCueAt;
      this.lastSequence = stored.lastSequence;
      this.cueCount = stored.cueCount;
      this.modelCalls = stored.modelCalls;
      this.phase = this.paused ? "paused" : "listening";
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    const snapshot = this.window.serialize();
    const state: StoredSessionState = {
      schemaVersion: 1,
      createdAt: this.createdAt,
      expiresAt: this.createdAt + this.maxSessionMs,
      mode: this.mode,
      paused: this.paused,
      muted: this.muted,
      recentSegments: snapshot.segments,
      summary: snapshot.summary,
      recentCues: this.recentCues,
      nextAllowedCueAt: this.nextAllowedCueAt,
      lastSequence: this.lastSequence,
      cueCount: this.cueCount,
      modelCalls: this.modelCalls,
    };
    await this.ctx.storage.put("state", state);
  }

  // -------------------------------------------------------------------------
  // HTTP entry points (already authenticated by the Worker router)
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/end")) {
      await this.shutdown("Session ended");
      return Response.json({ ok: true });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    if (this.phase === "ended") {
      return new Response("Session ended", { status: 410 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["primary"]);
    server.serializeAttachment({ protocolVersion: 1 });

    this.lastActivityAt = Date.now();
    await this.scheduleHousekeeping();

    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------
  // WebSocket handlers (hibernation API)
  // -------------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.hydrate();
    if (this.phase === "ended") return;
    this.lastActivityAt = Date.now();

    if (typeof message === "string") {
      await this.handleControlMessage(ws, message);
    } else {
      await this.handleAudio(ws, message);
    }
  }

  async webSocketClose(): Promise<void> {
    if (this.phase === "ended") return;
    if (this.ctx.getWebSockets().length === 0) {
      // Give the page a short grace window to reconnect, then clean up.
      await this.ctx.storage.setAlarm(Date.now() + LIMITS.DISCONNECT_GRACE_MS);
    }
  }

  async webSocketError(): Promise<void> {
    await this.webSocketClose();
  }

  async alarm(): Promise<void> {
    await this.hydrate();
    const now = Date.now();
    const disconnected = this.ctx.getWebSockets().length === 0;
    const inactive = now - this.lastActivityAt >= this.ttlMs;
    const overMaxAge = now - this.createdAt >= this.maxSessionMs;

    if (disconnected || inactive || overMaxAge) {
      await this.shutdown("Session expired");
      return;
    }
    // Deferred evaluation rounds ride the same alarm; maybeEvaluate gates
    // itself (interval, pause, empty window), so a spurious fire is a no-op.
    this.evalDueAt = 0;
    await this.maybeEvaluate();
    if (this.phase !== "ended") await this.scheduleHousekeeping();
  }

  private async scheduleHousekeeping(): Promise<void> {
    const nextTtl = this.lastActivityAt + this.ttlMs;
    const hardStop = this.createdAt + this.maxSessionMs;
    let next = Math.min(nextTtl, hardStop);
    if (this.evalDueAt !== 0) next = Math.min(next, this.evalDueAt);
    await this.ctx.storage.setAlarm(next);
  }

  /**
   * Ask the alarm to run one evaluation round shortly. In-memory timers
   * do not survive hibernation for WebSocket-hibernating objects; the
   * storage alarm is the only wake-up that is guaranteed to fire.
   */
  private async scheduleEvaluation(delayMs: number): Promise<void> {
    const due = Date.now() + delayMs;
    if (this.evalDueAt === 0 || due < this.evalDueAt) this.evalDueAt = due;
    await this.scheduleHousekeeping();
  }

  private async shutdown(reason: string): Promise<void> {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.inflightEval?.abort();
    this.evalDueAt = 0;
    this.log("info", "session_end", {
      cues: this.cueCount,
      modelCalls: this.modelCalls,
      ageMs: Date.now() - this.createdAt,
    });
    this.broadcast(serverMessage("state", { state: "ended" }));
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1000, reason);
      } catch {
        // already closed
      }
    }
    this.window.clear();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  // -------------------------------------------------------------------------
  // Control messages
  // -------------------------------------------------------------------------

  private async handleControlMessage(ws: WebSocket, raw: string): Promise<void> {
    if (raw.length > LIMITS.MAX_TEXT_MESSAGE_CHARS) {
      this.send(ws, serverMessage("error", { code: "message_too_large", recoverable: true }));
      return;
    }
    let parsed: ClientMessage;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      this.send(ws, serverMessage("error", { code: "invalid_message", recoverable: true }));
      return;
    }

    switch (parsed.type) {
      case "hello": {
        this.debug = parsed.capabilities.debug === true;
        this.phase = transition(this.phase, this.paused ? "paused" : "listening");
        this.send(
          ws,
          serverMessage("ready", {
            config: {
              session_id: this.ctx.id.toString(),
              reaction_mode: this.mode,
              sound_manifest_version: SOUND_MANIFEST_VERSION,
              max_session_seconds: Math.floor(this.maxSessionMs / 1000),
              transcription_provider: this.stt.name,
              classifier: this.model.name,
            },
          }),
        );
        this.send(ws, serverMessage("state", { state: this.paused ? "paused" : "listening" }));
        await this.persist();
        break;
      }
      case "audio_meta": {
        if (parsed.duration_ms > LIMITS.MAX_CHUNK_DURATION_MS) {
          this.send(ws, serverMessage("error", { code: "chunk_too_long", recoverable: true }));
          return;
        }
        if (parsed.seq <= this.lastSequence - LIMITS.MAX_SEQUENCE_LAG) {
          this.send(ws, serverMessage("error", { code: "stale_sequence", recoverable: true }));
          return;
        }
        this.pendingMeta = {
          seq: parsed.seq,
          mime: parsed.mime,
          durationMs: parsed.duration_ms,
          speech: parsed.speech !== false,
          receivedAt: Date.now(),
        };
        break;
      }
      case "pause": {
        this.paused = true;
        this.pendingMeta = null;
        this.pcm.reset();
        this.inflightEval?.abort();
        this.evalDueAt = 0;
        this.phase = transition(this.phase, "paused");
        this.broadcast(serverMessage("state", { state: "paused" }));
        await this.persist();
        break;
      }
      case "resume": {
        this.paused = false;
        this.phase = transition(this.phase, "listening");
        this.broadcast(serverMessage("state", { state: "listening" }));
        await this.persist();
        break;
      }
      case "stop": {
        await this.shutdown("Stopped by user");
        break;
      }
      case "mute_state": {
        this.muted = parsed.value === true;
        await this.persist();
        break;
      }
      case "cue_ack": {
        this.log("debug", "cue_ack", { phase: parsed.phase, cue_event_id: parsed.cue_event_id });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Audio → transcript → classification → policy → cue
  // -------------------------------------------------------------------------

  private async handleAudio(ws: WebSocket, bytes: ArrayBuffer): Promise<void> {
    if (this.paused || this.phase === "ended") return;

    const meta = this.pendingMeta;
    this.pendingMeta = null;
    if (!meta || Date.now() - meta.receivedAt > 10_000) {
      this.send(ws, serverMessage("error", { code: "missing_audio_meta", recoverable: true }));
      return;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.MAX_CHUNK_BYTES) {
      this.send(ws, serverMessage("error", { code: "bad_chunk_size", recoverable: true }));
      return;
    }
    if (!this.consumeAudioBudget(bytes.byteLength)) {
      this.send(ws, serverMessage("notice", { code: "audio_budget", message: "Audio rate limit reached; dropping audio for a moment." }));
      return;
    }
    if (meta.seq <= this.lastSequence) return; // duplicate or out-of-order
    this.lastSequence = meta.seq;

    // Streaming path: raw 16 kHz PCM packets roll into a server-side
    // window that flushes at conversational pauses or a full window.
    if (meta.mime.startsWith("audio/pcm")) {
      this.pcm.add(new Uint8Array(bytes), meta.durationMs, meta.speech);
      if (!this.pcm.shouldFlush()) return;
      const flushed = this.pcm.flush();
      if (!flushed) return;
      await this.transcribeAndReact(
        ws,
        flushed.wav,
        "audio/wav",
        meta.seq,
        flushed.durationMs,
        flushed.startedAtMs,
      );
      return;
    }

    // Legacy path: a self-contained encoded blob per utterance.
    await this.transcribeAndReact(
      ws,
      bytes,
      meta.mime,
      meta.seq,
      meta.durationMs,
      Date.now() - meta.durationMs,
    );
  }

  private async transcribeAndReact(
    ws: WebSocket,
    bytes: ArrayBuffer,
    mimeType: string,
    sequence: number,
    durationMs: number,
    startedAtMs: number,
  ): Promise<void> {
    let segments: TranscriptSegment[] = [];
    try {
      segments = await this.stt.transcribe(
        { bytes, mimeType, sequence, startedAtMs, durationMs },
        AbortSignal.timeout(LIMITS.STT_TIMEOUT_MS),
      );
    } catch (err) {
      // STT failure must not kill the session; stay in visual-only mode.
      this.log("warn", "stt_error", { message: err instanceof Error ? err.message : "unknown" });
      return;
    }
    // `bytes` goes out of scope here; raw audio is never stored.

    if (segments.length === 0) return;
    const now = Date.now();
    this.window.add(segments, now);
    if (this.debug) {
      this.send(ws, serverMessage("transcript_debug", { segments }));
    }
    await this.persist();
    await this.maybeEvaluate();
  }

  private consumeAudioBudget(byteLength: number): boolean {
    const now = Date.now();
    if (now - this.minuteWindowStart >= 60_000) {
      this.minuteWindowStart = now;
      this.bytesThisMinute = 0;
    }
    if (this.bytesThisMinute + byteLength > this.maxAudioBytesPerMinute) return false;
    this.bytesThisMinute += byteLength;
    return true;
  }

  private async maybeEvaluate(): Promise<void> {
    const now = Date.now();
    if (this.paused || this.muted || this.phase === "ended") return;
    if (now - this.lastEvalAt < this.minEvalIntervalMs) {
      // Transcripts often land mid-cooldown (parallel STT calls can even
      // finish out of order, punchline before setup). Dropping this round
      // outright would mean the completed joke never gets judged — defer
      // one re-evaluation to just past the interval instead.
      await this.scheduleEvaluation(this.minEvalIntervalMs - (now - this.lastEvalAt) + 50);
      return;
    }
    if (this.modelCalls >= LIMITS.MAX_MODEL_CALLS_PER_SESSION) return;

    const immediate = this.window.immediate(now);
    if (immediate.length === 0) return;

    // Supersede any in-flight evaluation: newer transcript wins.
    this.inflightEval?.abort();
    const controller = new AbortController();
    this.inflightEval = controller;
    const epoch = ++this.evalEpoch;
    this.lastEvalAt = now;
    this.modelCalls += 1;

    this.phase = transition(this.phase, "evaluating");
    this.broadcast(serverMessage("state", { state: "evaluating" }));

    const catalog = activeCatalog(this.mode).map((s) => ({
      id: s.id,
      description: s.description,
    }));
    const input: ReactionInput = {
      segments: immediate,
      summary: this.window.summary(),
      overlappingSpeech: this.window.overlappingSpeech(now),
      recentCues: this.recentCues.slice(-5).map((c) => ({
        cue: c.cue,
        at_ms_ago: now - c.atMs,
      })),
      catalog,
      nowMs: now,
    };

    const proposal = await this.model.classify(input, controller.signal);
    if (epoch !== this.evalEpoch || this.phase === "ended") return; // superseded

    const decisionNow = Date.now();
    const decision = evaluateProposal(proposal, this.policyContext(decisionNow));
    this.log("debug", "proposal", {
      cue: proposal.cue,
      confidence: proposal.confidence,
      allowed: decision.allowed,
      reasons: decision.reasons,
    });
    if (this.debug) {
      this.broadcast(
        serverMessage("notice", {
          code: "proposal",
          message: `${proposal.cue} conf=${proposal.confidence} → ${decision.allowed ? "play" : decision.reasons.join(",")}`,
        }),
      );
    }

    if (!decision.allowed) {
      this.phase = transition(this.phase, "listening");
      this.broadcast(serverMessage("state", { state: "listening" }));
      return;
    }

    this.recentCues.push({
      cue: decision.cue,
      reasonCode: proposal.reason_code,
      atMs: decisionNow,
    });
    if (this.recentCues.length > LIMITS.MAX_CUES_PER_SESSION) {
      this.recentCues = this.recentCues.slice(-LIMITS.MAX_CUES_PER_SESSION);
    }
    this.cueCount += 1;
    this.nextAllowedCueAt = decisionNow + Math.max(this.minEvalIntervalMs * 2, 6_000);

    this.phase = transition(this.phase, "cueing");
    this.broadcast(
      serverMessage("cue", {
        cue: decision.cue,
        gain: decision.gain,
        delay_ms: decision.delayMs,
      }),
    );
    this.phase = transition(this.phase, "listening");
    this.broadcast(serverMessage("state", { state: "listening" }));
    await this.persist();
  }

  private policyContext(now: number): PolicyContext {
    return {
      nowMs: now,
      mode: this.mode,
      muted: this.muted,
      minIntervalMs: this.minEvalIntervalMs,
      nextAllowedCueAtMs: this.nextAllowedCueAt,
      recentCues: this.recentCues,
      cuesPlayedThisSession: this.cueCount,
      recentText: this.window.recentText(now),
      currentSegmentIds: new Set(this.window.immediate(now).map((s) => s.id)),
    };
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already closed; the close handler owns cleanup.
    }
  }

  private broadcast(message: ServerMessage): void {
    const raw = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(raw);
      } catch {
        // ignore closed sockets
      }
    }
  }

  private log(level: "debug" | "info" | "warn", event: string, fields: Record<string, unknown>): void {
    const configured = this.env.LOG_LEVEL === "debug" ? 0 : this.env.LOG_LEVEL === "warn" ? 2 : 1;
    const rank = level === "debug" ? 0 : level === "info" ? 1 : 2;
    if (rank < configured) return;
    // Structured, transcript-free logging only.
    console.log(JSON.stringify({ level, event, session: this.ctx.id.toString().slice(0, 8), ...fields }));
  }
}
