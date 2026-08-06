import {
  NONE_PROPOSAL,
  ReactionProposalSchema,
  type ReactionProposal,
} from "../shared/schema";
import {
  buildReactionUserPayload,
  buildSystemPolicy,
  type ReactionInput,
  type ReactionModel,
} from "./reaction-model";

interface DeepSeekOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

/**
 * DeepSeek V4 Flash through the OpenAI-compatible Chat Completions endpoint.
 * Non-thinking mode + JSON output for latency. A model that answers gets
 * parsed leniently (`none` on malformed output), but transport-level failure
 * — timeout, bad status, network error — THROWS so the factory's fallback
 * wrapper can hand the round to another classifier instead of the product
 * going silently mute. A supersede abort still resolves quietly to `none`.
 */
export class DeepSeekReactionModel implements ReactionModel {
  readonly name = "deepseek";
  private readonly timeoutMs: number;

  constructor(private readonly opts: DeepSeekOptions) {
    this.timeoutMs = opts.timeoutMs ?? 2500;
  }

  async classify(input: ReactionInput, signal: AbortSignal): Promise<ReactionProposal> {
    let response: Response;
    try {
      response = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.opts.model,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 160,
          messages: [
            { role: "system", content: buildSystemPolicy(input.catalog) },
            { role: "user", content: buildReactionUserPayload(input) },
          ],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
    } catch (err) {
      if (signal.aborted) return NONE_PROPOSAL; // superseded, not a failure
      throw err instanceof Error ? err : new Error("deepseek_fetch_failed");
    }

    if (!response.ok) {
      // Drain the body so the connection can be reused.
      await response.text().catch(() => {});
      throw new Error(`deepseek_status_${response.status}`);
    }

    let body: { choices?: { message?: { content?: string } }[] };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new Error("deepseek_bad_body");
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) return NONE_PROPOSAL;
    return parseProposal(content);
  }
}

/**
 * Parse model output into a validated proposal. Anything outside one strict
 * JSON object — freeform prose, code fences, extra fields — becomes `none`.
 */
export function parseProposal(raw: string): ReactionProposal {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NONE_PROPOSAL;
  }
  const result = ReactionProposalSchema.safeParse(parsed);
  return result.success ? result.data : NONE_PROPOSAL;
}
