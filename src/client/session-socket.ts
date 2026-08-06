import { newId } from "../shared/ids";
import type {
  ClientMessage,
  CreateSessionResponse,
  ServerMessage,
} from "../shared/schema";

type ServerMessageHandler = {
  [T in ServerMessage["type"]]?: (msg: Extract<ServerMessage, { type: T }>) => void;
} & {
  onDisconnect?: (permanent: boolean) => void;
};

const HEARTBEAT_MS = 20_000;
const RECONNECT_ATTEMPTS = 3;

/**
 * One page visit's connection to its Durable Object. Holds the session
 * credential in memory only; a reload deliberately creates a new session.
 */
export class SessionClient {
  private session: CreateSessionResponse | null = null;
  private socket: WebSocket | null = null;
  private heartbeat: number | undefined;
  private seq = 0;
  private closedByUs = false;
  private reconnectsLeft = RECONNECT_ATTEMPTS;

  constructor(private readonly handlers: ServerMessageHandler) {}

  async create(): Promise<void> {
    const response = await fetch("/api/sessions", { method: "POST" });
    if (!response.ok) throw new Error(`session create failed: ${response.status}`);
    this.session = (await response.json()) as CreateSessionResponse;
  }

  async connect(capabilities: { mime: string; reduced_motion: boolean; debug: boolean }): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("create() first");

    const wsUrl = new URL(session.websocket_url, location.href);
    wsUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("token", session.session_token);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.reconnectsLeft = RECONNECT_ATTEMPTS;
        this.sendJson({
          v: 1,
          type: "hello",
          event_id: newId("evt"),
          sent_at: Date.now(),
          capabilities,
        });
        this.heartbeat = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("ping");
        }, HEARTBEAT_MS);
        resolve();
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        const handler = this.handlers[message.type] as
          | ((msg: ServerMessage) => void)
          | undefined;
        handler?.(message);
      });

      socket.addEventListener("close", () => {
        window.clearInterval(this.heartbeat);
        if (this.closedByUs) return;
        if (this.reconnectsLeft > 0) {
          this.reconnectsLeft -= 1;
          setTimeout(() => {
            this.connect(capabilities).catch(() => this.handlers.onDisconnect?.(true));
          }, 1200 * (RECONNECT_ATTEMPTS - this.reconnectsLeft));
          this.handlers.onDisconnect?.(false);
        } else {
          this.handlers.onDisconnect?.(true);
        }
      });

      socket.addEventListener("error", () => {
        if (socket.readyState !== WebSocket.OPEN) reject(new Error("websocket failed"));
      });
    });
  }

  sendJson(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  sendControl(type: "pause" | "resume" | "stop" | "mute_state", value?: boolean): void {
    this.sendJson({
      v: 1,
      type,
      event_id: newId("evt"),
      sent_at: Date.now(),
      ...(value === undefined ? {} : { value }),
    } as ClientMessage);
  }

  sendCueAck(cueEventId: string, phase: "started" | "ended"): void {
    this.sendJson({
      v: 1,
      type: "cue_ack",
      event_id: newId("evt"),
      sent_at: Date.now(),
      cue_event_id: cueEventId,
      phase,
    });
  }

  sendAudio(bytes: ArrayBuffer, durationMs: number, mimeType: string, speech = true): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      v: 1,
      type: "audio_meta",
      event_id: newId("evt"),
      sent_at: Date.now(),
      seq: this.seq++,
      mime: mimeType,
      duration_ms: durationMs,
      speech,
    });
    this.socket.send(bytes);
  }

  /** End the session: WS stop + best-effort DELETE for immediate cleanup. */
  async end(): Promise<void> {
    this.closedByUs = true;
    window.clearInterval(this.heartbeat);
    this.sendControl("stop");
    this.socket?.close(1000, "ended by user");
    const session = this.session;
    if (session) {
      await fetch(`/api/sessions/${session.session_id}`, {
        method: "DELETE",
        headers: { "X-Session-Token": session.session_token },
      }).catch(() => {});
    }
    this.session = null;
  }
}
