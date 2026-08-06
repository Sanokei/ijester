import type { ReactionProposal } from "../shared/schema";
import {
  activeCatalog,
  soundById,
  type ReactionMode,
} from "../shared/sound-catalog";
import { clamp } from "../shared/time";
import { LIMITS } from "./protocol";

export interface CueHistoryItem {
  cue: string;
  reasonCode: string;
  atMs: number;
}

export interface PolicyContext {
  nowMs: number;
  mode: ReactionMode;
  muted: boolean;
  /** Global floor between any two cues. */
  minIntervalMs: number;
  nextAllowedCueAtMs: number;
  recentCues: CueHistoryItem[];
  cuesPlayedThisSession: number;
  /** Recent transcript text, scanned for sensitive context. */
  recentText: string;
  /** Segment ids currently in the immediate window. */
  currentSegmentIds: Set<string>;
}

export interface PolicyDecision {
  allowed: boolean;
  cue: string;
  gain: number;
  delayMs: number;
  /** Machine-readable reasons; safe to log (no transcript text). */
  reasons: string[];
}

const DENY = (reasons: string[]): PolicyDecision => ({
  allowed: false,
  cue: "none",
  gain: 0,
  delayMs: 0,
  reasons,
});

/**
 * Sensitive-context suppression. When any of these appear in the immediate
 * window, no cue may fire at all: a laugh track landing on bad news is the
 * single worst thing this product could do.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(died|dying|passed away|funeral|grief|grieving|miscarriage)\b/i,
  /\b(suicide|suicidal|self[- ]harm|kill (myself|himself|herself|themselves))\b/i,
  /\b(cancer|diagnosis|diagnosed|tumor|hospice|chemo|ambulance|911|999)\b/i,
  /\b(er visit|the er|emergency room|hospitalized|in the hospital|intensive care)\b/i,
  /\b(heart attack|stroke|seizure|overdose|can'?t breathe|call an ambulance)\b/i,
  /\b(assault|assaulted|abuse|abusive|raped?|molest)\b/i,
  /\b(shooting|stabbed|gunshot|murdered?)\b/i,
  /\b(fired me|laid off|lost my job|evicted|foreclosure)\b/i,
  /\b(divorce papers|custody battle|restraining order)\b/i,
];

export function hasSensitiveContext(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

/**
 * The deterministic gate between a model proposal and the client's speaker.
 * Every check that fails downgrades to silence; the model has no authority.
 */
export function evaluateProposal(
  proposal: ReactionProposal,
  ctx: PolicyContext,
): PolicyDecision {
  if (proposal.cue === "none") return DENY(["proposed_none"]);
  if (ctx.muted) return DENY(["muted"]);

  const sound = soundById(proposal.cue);
  if (!sound) return DENY(["unknown_cue"]);

  if (!activeCatalog(ctx.mode).some((s) => s.id === sound.id)) {
    return DENY(["cue_disabled_in_mode"]);
  }

  if (proposal.confidence < sound.minConfidence) {
    return DENY(["below_confidence_threshold"]);
  }

  if (ctx.nowMs < ctx.nextAllowedCueAtMs) return DENY(["global_cooldown"]);

  const lastSameCue = [...ctx.recentCues]
    .reverse()
    .find((c) => c.cue === sound.id);
  if (lastSameCue && ctx.nowMs - lastSameCue.atMs < sound.cooldownMs) {
    return DENY(["cue_cooldown"]);
  }

  // Duplicate suppression: the same cue for the same semantic moment
  // (matching reason_code) within a minute reads as a broken laugh machine.
  const duplicate = ctx.recentCues.some(
    (c) =>
      c.cue === sound.id &&
      c.reasonCode === proposal.reason_code &&
      ctx.nowMs - c.atMs < 60_000,
  );
  if (duplicate) return DENY(["duplicate_moment"]);

  if (
    proposal.target_segment_id !== "" &&
    !ctx.currentSegmentIds.has(proposal.target_segment_id)
  ) {
    return DENY(["stale_target_segment"]);
  }
  if (proposal.target_segment_id === "") return DENY(["missing_target_segment"]);

  if (hasSensitiveContext(ctx.recentText)) return DENY(["sensitive_context"]);

  if (ctx.cuesPlayedThisSession >= LIMITS.MAX_CUES_PER_SESSION) {
    return DENY(["session_cue_budget"]);
  }
  const playsOfThisCue = ctx.recentCues.filter((c) => c.cue === sound.id).length;
  if (playsOfThisCue >= sound.maxPlaysPerSession) {
    return DENY(["cue_session_budget"]);
  }

  // Intensity scales gain modestly around the catalog default; the model
  // cannot exceed the clamp no matter what it returns.
  const intensity = clamp(proposal.intensity, 0, 3);
  const gain = clamp(sound.defaultGain * (0.85 + intensity * 0.1), 0.05, 0.9);
  const delayMs = clamp(proposal.delay_ms, 0, 1200);

  return { allowed: true, cue: sound.id, gain, delayMs, reasons: ["ok"] };
}
