import {
  NONE_PROPOSAL,
  ReactionProposalSchema,
  type AudioChunk,
  type ReactionProposal,
  type TranscriptSegment,
} from "../shared/schema";
import type { TranscriptionProvider } from "./transcription";
import { newId } from "../shared/ids";
import { parseProposal } from "./deepseek";
import {
  buildReactionUserPayload,
  buildSystemPolicy,
  type ReactionInput,
  type ReactionModel,
} from "./reaction-model";

/**
 * Speech-to-text via Workers AI Whisper. Runs inside Cloudflare with no
 * extra API key. Whisper accepts the raw encoded bytes (webm/ogg/wav).
 */
export class WorkersAiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "workers-ai";

  constructor(private readonly ai: Ai) {}

  async transcribe(chunk: AudioChunk, signal: AbortSignal): Promise<TranscriptSegment[]> {
    if (signal.aborted) return [];
    const result = (await this.ai.run("@cf/openai/whisper", {
      audio: [...new Uint8Array(chunk.bytes)],
    })) as { text?: string };

    const text = result.text?.trim();
    if (!text) return [];

    return [
      {
        id: newId("seg"),
        // Whisper does not diarize; a later provider can supply real turns.
        speaker: "S1",
        text,
        startMs: chunk.startedAtMs,
        endMs: chunk.startedAtMs + chunk.durationMs,
        final: true,
      },
    ];
  }
}

export const DEFAULT_REACTION_LLM = "@cf/meta/llama-3.1-8b-instruct-fast";

/** Never let one classification hold the pipeline hostage. */
const CLASSIFY_TIMEOUT_MS = 3_000;

/**
 * Reaction classifier on a Workers AI instruct model. The default fallback
 * when no DEEPSEEK_API_KEY is configured: it needs no external key, so the
 * product actually reacts out of the box instead of degrading to the keyword
 * heuristic. Same prompt contract as DeepSeek; any failure resolves `none`.
 */
export class WorkersAiReactionModel implements ReactionModel {
  readonly name = "workers-ai";

  constructor(
    private readonly ai: Ai,
    private readonly model: string = DEFAULT_REACTION_LLM,
  ) {}

  async classify(input: ReactionInput, signal: AbortSignal): Promise<ReactionProposal> {
    if (signal.aborted) return NONE_PROPOSAL;
    try {
      // The binding accepts any catalog model id; the typed overloads only
      // cover the literals baked into workers-types.
      const run = this.ai.run.bind(this.ai) as (
        model: string,
        inputs: Record<string, unknown>,
      ) => Promise<unknown>;
      const result = await Promise.race([
        run(this.model, {
          messages: [
            { role: "system", content: buildSystemPolicy(input.catalog) },
            { role: "user", content: buildReactionUserPayload(input) },
          ],
          temperature: 0.1,
          max_tokens: 160,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFY_TIMEOUT_MS)),
      ]);
      if (signal.aborted || result === null) return NONE_PROPOSAL;
      // Depending on the model, the binding returns either `{response}` or an
      // OpenAI-style `{choices}` envelope; `response` may even arrive as an
      // already-parsed object when the output is pure JSON.
      const body = result as {
        response?: unknown;
        choices?: { message?: { content?: unknown } }[];
      };
      const out = body.response ?? body.choices?.[0]?.message?.content;
      if (typeof out === "string") return parseProposal(out);
      if (out && typeof out === "object") {
        const parsed = ReactionProposalSchema.safeParse(out);
        return parsed.success ? parsed.data : NONE_PROPOSAL;
      }
      return NONE_PROPOSAL;
    } catch {
      return NONE_PROPOSAL;
    }
  }
}
