import type { Env } from "../worker/env";
import { DeepSeekReactionModel } from "./deepseek";
import { HeuristicReactionModel, MockTranscriptionProvider } from "./mock";
import type { ReactionModel } from "./reaction-model";
import type { TranscriptionProvider } from "./transcription";
import { WorkersAiTranscriptionProvider } from "./workers-ai";

export function createTranscriptionProvider(env: Env): TranscriptionProvider {
  if (env.TRANSCRIPTION_PROVIDER === "workers-ai" && env.AI) {
    return new WorkersAiTranscriptionProvider(env.AI);
  }
  return new MockTranscriptionProvider();
}

export function createReactionModel(env: Env): ReactionModel {
  if (env.DEEPSEEK_API_KEY) {
    return new DeepSeekReactionModel({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    });
  }
  return new HeuristicReactionModel();
}
