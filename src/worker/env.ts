export interface Env {
  ASSETS?: Fetcher;
  IJESTER_SESSION: DurableObjectNamespace;
  AI?: Ai;

  // Secrets (wrangler secret put / .dev.vars). All optional so the app can
  // degrade to heuristic/mock providers instead of crashing.
  DEEPSEEK_API_KEY?: string;
  STT_API_KEY?: string;
  SESSION_TOKEN_SECRET?: string;

  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;
  TRANSCRIPTION_PROVIDER: string;
  SESSION_TTL_SECONDS: string;
  MAX_SESSION_SECONDS: string;
  MAX_AUDIO_BYTES_PER_MINUTE: string;
  REACTION_MIN_INTERVAL_MS: string;
  REACTION_MODE: string;
  LOG_LEVEL: string;
}
