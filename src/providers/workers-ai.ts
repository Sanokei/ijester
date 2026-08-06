import type { AudioChunk, TranscriptSegment } from "../shared/schema";
import type { TranscriptionProvider } from "./transcription";
import { newId } from "../shared/ids";

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
