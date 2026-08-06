import { NONE_PROPOSAL, type ReactionProposal } from "../shared/schema";
import type { Env } from "../worker/env";
import { DeepSeekReactionModel } from "./deepseek";
import { HeuristicReactionModel, MockTranscriptionProvider } from "./mock";
import type { ReactionInput, ReactionModel } from "./reaction-model";
import type { TranscriptionProvider } from "./transcription";
import {
  WorkersAiReactionModel,
  WorkersAiTranscriptionProvider,
} from "./workers-ai";

export function createTranscriptionProvider(env: Env): TranscriptionProvider {
  if (env.TRANSCRIPTION_PROVIDER === "workers-ai" && env.AI) {
    return new WorkersAiTranscriptionProvider(env.AI);
  }
  return new MockTranscriptionProvider();
}

/**
 * Catches a throwing primary classifier, logs the failure (visible in the
 * Cloudflare dashboard — a mute laugh machine should never be a mystery),
 * and gives the round to the fallback. Before this wrapper, a DeepSeek
 * outage or bad key surfaced as an endless "stayed quiet".
 */
class ResilientReactionModel implements ReactionModel {
  readonly name: ReactionModel["name"];

  constructor(
    private readonly primary: ReactionModel,
    private readonly fallback: ReactionModel,
  ) {
    this.name = primary.name;
  }

  async classify(input: ReactionInput, signal: AbortSignal): Promise<ReactionProposal> {
    try {
      return await this.primary.classify(input, signal);
    } catch (err) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "classifier_error",
          provider: this.primary.name,
          message: err instanceof Error ? err.message : "unknown",
        }),
      );
      if (signal.aborted) return NONE_PROPOSAL;
      try {
        return await this.fallback.classify(input, signal);
      } catch {
        return NONE_PROPOSAL;
      }
    }
  }
}

export function createReactionModel(env: Env): ReactionModel {
  const fallback = env.AI
    ? new WorkersAiReactionModel(env.AI, env.WORKERS_AI_REACTION_MODEL || undefined)
    : new HeuristicReactionModel();
  if (env.DEEPSEEK_API_KEY) {
    return new ResilientReactionModel(
      new DeepSeekReactionModel({
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      }),
      fallback,
    );
  }
  return fallback;
}
