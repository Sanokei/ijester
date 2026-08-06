import { pcm16ToWav } from "../shared/wav";

export interface AggregatorFlush {
  wav: ArrayBuffer;
  durationMs: number;
  speechMs: number;
  /** Wall-clock time the window's first packet arrived. */
  startedAtMs: number;
}

const DEFAULTS = {
  sampleRate: 16_000,
  /** Flush once this much audio is buffered regardless of pauses. */
  maxWindowMs: 3_000,
  /** Flush early when a pause follows at least this much speech. */
  minSpeechMs: 600,
  trailingSilenceMs: 700,
  /** Hard cap — drop-oldest safety if flushes stall. */
  maxBufferMs: 10_000,
};

/**
 * Server-side rolling window over a continuous 16 kHz PCM stream. The
 * client streams small packets as they are captured; this decides when a
 * conversational window is ready to transcribe (a pause after speech, or a
 * full window) and hands back a standalone WAV. Buffers live only in DO
 * memory and are discarded on flush.
 */
export class PcmAggregator {
  private chunks: Uint8Array[] = [];
  private bufferedMs = 0;
  private speechMs = 0;
  private trailingSilence = 0;
  private firstAddedAt = 0;
  private readonly opts: typeof DEFAULTS;

  constructor(opts: Partial<typeof DEFAULTS> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  add(bytes: Uint8Array, durationMs: number, speech: boolean): void {
    if (this.chunks.length === 0) this.firstAddedAt = Date.now();
    this.chunks.push(bytes);
    this.bufferedMs += durationMs;
    if (speech) {
      this.speechMs += durationMs;
      this.trailingSilence = 0;
    } else {
      this.trailingSilence += durationMs;
    }
    // Safety: never grow unbounded.
    while (this.bufferedMs > this.opts.maxBufferMs && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      const droppedMs = (dropped.length / 2 / this.opts.sampleRate) * 1000;
      this.bufferedMs -= droppedMs;
    }
  }

  /** A window is ready when a pause follows speech, or the window is full. */
  shouldFlush(): boolean {
    if (this.speechMs < this.opts.minSpeechMs) {
      // Nothing but silence/noise so far: quietly discard long dead air.
      if (this.bufferedMs >= this.opts.maxWindowMs) this.reset();
      return false;
    }
    if (this.bufferedMs >= this.opts.maxWindowMs) return true;
    return this.trailingSilence >= this.opts.trailingSilenceMs;
  }

  flush(): AggregatorFlush | null {
    if (this.chunks.length === 0) return null;
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    const result: AggregatorFlush = {
      wav: pcm16ToWav(pcm, this.opts.sampleRate),
      durationMs: this.bufferedMs,
      speechMs: this.speechMs,
      startedAtMs: this.firstAddedAt,
    };
    this.reset();
    return result;
  }

  buffered(): number {
    return this.bufferedMs;
  }

  reset(): void {
    this.chunks = [];
    this.bufferedMs = 0;
    this.speechMs = 0;
    this.trailingSilence = 0;
  }
}
