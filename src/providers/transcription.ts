import type { AudioChunk, TranscriptSegment } from "../shared/schema";

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(chunk: AudioChunk, signal: AbortSignal): Promise<TranscriptSegment[]>;
}
