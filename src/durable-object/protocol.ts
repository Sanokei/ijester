import { newId } from "../shared/ids";
import type { ServerMessage } from "../shared/schema";

/** Hard limits enforced by the Durable Object regardless of configuration. */
export const LIMITS = {
  /** Largest accepted single audio frame (bytes). ~4 s of Opus is ~50 KB. */
  MAX_CHUNK_BYTES: 512_000,
  /** Largest accepted JSON control message (chars). */
  MAX_TEXT_MESSAGE_CHARS: 8_000,
  /** Reject audio_meta whose sequence is this far behind the newest seen. */
  MAX_SEQUENCE_LAG: 8,
  /** Reject chunks that report an implausible duration. */
  MAX_CHUNK_DURATION_MS: 15_000,
  /** Transcript retention window. */
  HOT_WINDOW_MS: 40_000,
  /** The immediate window the classifier may target. */
  IMMEDIATE_WINDOW_MS: 12_000,
  /** Cap on stored summary characters (~300-600 tokens). */
  MAX_SUMMARY_CHARS: 1_600,
  /** Absolute cap on cues per session. */
  MAX_CUES_PER_SESSION: 60,
  /** Absolute cap on classifier calls per session (cost circuit breaker). */
  MAX_MODEL_CALLS_PER_SESSION: 600,
  /** STT + classification watchdog timeouts. */
  STT_TIMEOUT_MS: 4_000,
  CLASSIFY_TIMEOUT_MS: 3_000,
  /** WebSocket reconnect grace before the DO wipes state on disconnect. */
  DISCONNECT_GRACE_MS: 30_000,
} as const;

export function serverMessage<T extends ServerMessage["type"]>(
  type: T,
  fields: Omit<Extract<ServerMessage, { type: T }>, "v" | "type" | "event_id" | "sent_at">,
): Extract<ServerMessage, { type: T }> {
  return {
    v: 1,
    type,
    event_id: newId("evt"),
    sent_at: Date.now(),
    ...fields,
  } as Extract<ServerMessage, { type: T }>;
}
