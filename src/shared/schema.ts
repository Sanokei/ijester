/**
 * Shared wire types and runtime schemas. Used by the client, the Worker
 * router, and the Durable Object so both sides of the WebSocket agree.
 */
import { z } from "zod";
import { ALL_CUE_IDS } from "./sound-catalog";

// ---------------------------------------------------------------------------
// Iris / session state
// ---------------------------------------------------------------------------

export type IrisState =
  | "idle"
  | "permission"
  | "connecting"
  | "listening"
  | "speech"
  | "evaluating"
  | "cueing"
  | "paused"
  | "error"
  | "ended";

export interface PublicSessionConfig {
  session_id: string;
  reaction_mode: string;
  sound_manifest_version: string;
  max_session_seconds: number;
  transcription_provider: string;
  classifier: "deepseek" | "heuristic";
}

// ---------------------------------------------------------------------------
// Transcript / audio types
// ---------------------------------------------------------------------------

export type SpeakerLabel = "S1" | "S2" | "S3" | "unknown";

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerLabel;
  text: string;
  startMs: number;
  endMs: number;
  final: boolean;
  confidence?: number;
}

export interface AudioChunk {
  bytes: ArrayBuffer;
  mimeType: string;
  sequence: number;
  startedAtMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Reaction proposal (model output contract)
// ---------------------------------------------------------------------------

export const ReactionProposalSchema = z.strictObject({
  cue: z.string().refine((c) => ALL_CUE_IDS.includes(c), {
    message: "cue must be an allowlisted sound id or 'none'",
  }),
  confidence: z.number().min(0).max(1),
  intensity: z.int().min(0).max(3),
  delay_ms: z.int().min(0).max(1200),
  reason_code: z
    .string()
    .max(64)
    .regex(/^[a-z0-9_]*$/, "reason_code must be a lowercase slug"),
  target_segment_id: z.string().max(80),
});

export type ReactionProposal = z.infer<typeof ReactionProposalSchema>;

export const NONE_PROPOSAL: ReactionProposal = {
  cue: "none",
  confidence: 1,
  intensity: 0,
  delay_ms: 0,
  reason_code: "none",
  target_segment_id: "",
};

// ---------------------------------------------------------------------------
// WebSocket protocol (v1). All JSON messages share the envelope.
// ---------------------------------------------------------------------------

const envelope = {
  v: z.literal(1),
  event_id: z.string().min(1).max(64),
  sent_at: z.number(),
};

export const ClientHelloSchema = z.object({
  ...envelope,
  type: z.literal("hello"),
  capabilities: z.object({
    mime: z.string().max(80),
    sample_rate: z.number().optional(),
    reduced_motion: z.boolean().optional(),
    debug: z.boolean().optional(),
  }),
});

export const ClientAudioMetaSchema = z.object({
  ...envelope,
  type: z.literal("audio_meta"),
  seq: z.int().min(0),
  mime: z.string().max(80),
  duration_ms: z.number().min(1).max(30_000),
  /** Client VAD verdict for this packet (streaming PCM path). */
  speech: z.boolean().optional(),
});

export const ClientControlSchema = z.object({
  ...envelope,
  type: z.enum(["pause", "resume", "stop", "mute_state"]),
  value: z.boolean().optional(),
});

export const ClientCueAckSchema = z.object({
  ...envelope,
  type: z.literal("cue_ack"),
  cue_event_id: z.string().max(64),
  phase: z.enum(["started", "ended"]),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientAudioMetaSchema,
  ClientControlSchema.extend({ type: z.literal("pause") }),
  ClientControlSchema.extend({ type: z.literal("resume") }),
  ClientControlSchema.extend({ type: z.literal("stop") }),
  ClientControlSchema.extend({ type: z.literal("mute_state") }),
  ClientCueAckSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface ServerReadyMessage {
  v: 1;
  type: "ready";
  event_id: string;
  sent_at: number;
  config: PublicSessionConfig;
}

export interface ServerStateMessage {
  v: 1;
  type: "state";
  event_id: string;
  sent_at: number;
  state: IrisState;
}

export interface ServerCueMessage {
  v: 1;
  type: "cue";
  event_id: string;
  sent_at: number;
  cue: string;
  gain: number;
  delay_ms: number;
}

export interface ServerNoticeMessage {
  v: 1;
  type: "notice";
  event_id: string;
  sent_at: number;
  code: string;
  message: string;
}

export interface ServerErrorMessage {
  v: 1;
  type: "error";
  event_id: string;
  sent_at: number;
  code: string;
  recoverable: boolean;
}

export interface ServerTranscriptDebugMessage {
  v: 1;
  type: "transcript_debug";
  event_id: string;
  sent_at: number;
  segments: TranscriptSegment[];
}

export type ServerMessage =
  | ServerReadyMessage
  | ServerStateMessage
  | ServerCueMessage
  | ServerNoticeMessage
  | ServerErrorMessage
  | ServerTranscriptDebugMessage;

// ---------------------------------------------------------------------------
// Session creation response
// ---------------------------------------------------------------------------

export interface CreateSessionResponse {
  session_id: string;
  session_token: string;
  websocket_url: string;
  expires_at: string;
  sound_manifest_version: string;
}
