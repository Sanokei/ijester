import { newId } from "../shared/ids";
import {
  NONE_PROPOSAL,
  type AudioChunk,
  type ReactionProposal,
  type TranscriptSegment,
} from "../shared/schema";
import type { ReactionInput, ReactionModel } from "./reaction-model";
import type { TranscriptionProvider } from "./transcription";

/**
 * Offline transcription stand-in: cycles scripted conversation lines so the
 * full pipeline (window → classifier → policy → cue) can be exercised
 * without any speech service. The audio bytes are ignored and discarded.
 */
const FIXTURE_LINES: { speaker: TranscriptSegment["speaker"]; text: string }[] = [
  { speaker: "S1", text: "so anyway, we get to the airport and I realize I have my roommate's passport" },
  { speaker: "S2", text: "no you did not" },
  { speaker: "S1", text: "I fully checked in as Kevin. I was Kevin for forty minutes" },
  { speaker: "S2", text: "that is incredible, what happened at security" },
  { speaker: "S1", text: "the guy looks at the photo, looks at me, and says 'nice haircut, Kevin'" },
  { speaker: "S2", text: "okay but did I tell you the puppy found its way home on its own" },
  { speaker: "S1", text: "wait, seriously? it walked the whole way back? that is the sweetest thing" },
  { speaker: "S2", text: "three miles. it was sitting on the porch like nothing happened" },
];

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock";
  private cursor = 0;

  async transcribe(chunk: AudioChunk, signal: AbortSignal): Promise<TranscriptSegment[]> {
    if (signal.aborted) return [];
    const line = FIXTURE_LINES[this.cursor % FIXTURE_LINES.length]!;
    this.cursor += 1;
    return [
      {
        id: newId("seg"),
        speaker: line.speaker,
        text: line.text,
        startMs: chunk.startedAtMs,
        endMs: chunk.startedAtMs + chunk.durationMs,
        final: true,
      },
    ];
  }
}

/**
 * Keyword heuristic classifier used when no DEEPSEEK_API_KEY is configured.
 * Deliberately conservative; it exists so the product works end-to-end in
 * local dev and as a degraded fallback, not to be clever.
 */
const HEURISTICS: {
  cue: string;
  reason: string;
  confidence: number;
  pattern: RegExp;
}[] = [
  { cue: "aww", reason: "wholesome", confidence: 0.9, pattern: /\b(sweetest|adorable|puppy|kitten|so cute|aww+|wholesome|proud of you|that's so sweet)\b/i },
  { cue: "gasp", reason: "shock", confidence: 0.88, pattern: /\b(no way|you did not|i can'?t believe|what happened|seriously\?|oh my god|are you serious|you're kidding)\b/i },
  { cue: "ooo", reason: "callout", confidence: 0.88, pattern: /\b(spicy|scandal|caught (him|her|them)|flirt|secretly|drama|plot twist)\b/i },
  { cue: "laugh_light", reason: "banter", confidence: 0.85, pattern: /\b(nice haircut|i was \w+ for|fully checked in|lol|that's ridiculous|(ha){2,}|hilarious|so funny)\b/i },
  { cue: "tada", reason: "achievement", confidence: 0.87, pattern: /\b(i got the job|we won|i passed|nailed it|it's official)\b/i },
  { cue: "applause", reason: "good_news", confidence: 0.87, pattern: /\b(congratulations|congrats|well done|so proud of)\b/i },
  { cue: "drum_sting", reason: "pun", confidence: 0.86, pattern: /\b(get it\?|ba dum|pun intended)\b/i },
];

export class HeuristicReactionModel implements ReactionModel {
  readonly name = "heuristic";

  async classify(input: ReactionInput, signal: AbortSignal): Promise<ReactionProposal> {
    if (signal.aborted) return NONE_PROPOSAL;
    const latest = input.segments.at(-1);
    if (!latest) return NONE_PROPOSAL;

    const allowed = new Set(input.catalog.map((c) => c.id));
    for (const h of HEURISTICS) {
      if (!allowed.has(h.cue)) continue;
      if (h.pattern.test(latest.text)) {
        return {
          cue: h.cue,
          confidence: h.confidence,
          intensity: 1,
          delay_ms: 200,
          reason_code: h.reason,
          target_segment_id: latest.id,
        };
      }
    }
    return NONE_PROPOSAL;
  }
}
