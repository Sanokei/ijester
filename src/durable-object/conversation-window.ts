import type { TranscriptSegment } from "../shared/schema";
import { LIMITS } from "./protocol";

/**
 * Rolling, session-scoped conversation context. Holds only the hot window of
 * finalized transcript plus a compact plain-text summary of what scrolled
 * out. Never holds audio.
 */
export class ConversationWindow {
  private segments: TranscriptSegment[] = [];
  private summaryText = "";

  add(incoming: TranscriptSegment[], now: number): void {
    for (const seg of incoming) {
      if (!seg.final || !seg.text.trim()) continue;
      this.segments.push(seg);
    }
    this.segments.sort((a, b) => a.startMs - b.startMs);
    this.prune(now);
  }

  /** Evict segments older than the hot window, folding them into the summary. */
  prune(now: number): void {
    const cutoff = now - LIMITS.HOT_WINDOW_MS;
    const evicted = this.segments.filter((s) => s.endMs < cutoff);
    if (evicted.length > 0) {
      const folded = evicted.map((s) => `${s.speaker}: ${s.text}`).join(" / ");
      this.summaryText = `${this.summaryText} ${folded}`.trim();
      if (this.summaryText.length > LIMITS.MAX_SUMMARY_CHARS) {
        this.summaryText = `…${this.summaryText.slice(-LIMITS.MAX_SUMMARY_CHARS)}`;
      }
      this.segments = this.segments.filter((s) => s.endMs >= cutoff);
    }
  }

  /** The full hot window (last ~40 s). */
  hot(): TranscriptSegment[] {
    return [...this.segments];
  }

  /** The immediate trigger window (last ~12 s) the classifier may react to. */
  immediate(now: number): TranscriptSegment[] {
    const cutoff = now - LIMITS.IMMEDIATE_WINDOW_MS;
    return this.segments.filter((s) => s.endMs >= cutoff);
  }

  /** Whether a segment id is still inside the immediate window. */
  isCurrent(segmentId: string, now: number): boolean {
    return this.immediate(now).some((s) => s.id === segmentId);
  }

  /** True when two speakers have segments overlapping in time recently. */
  overlappingSpeech(now: number): boolean {
    const recent = this.immediate(now);
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1]!;
      const cur = recent[i]!;
      if (cur.speaker !== prev.speaker && cur.startMs < prev.endMs) return true;
    }
    return false;
  }

  summary(): string {
    return this.summaryText;
  }

  /** All recent text, for sensitive-context scanning. */
  recentText(now: number): string {
    return this.immediate(now)
      .map((s) => s.text)
      .join(" ");
  }

  clear(): void {
    this.segments = [];
    this.summaryText = "";
  }

  serialize(): { segments: TranscriptSegment[]; summary: string } {
    return { segments: this.segments, summary: this.summaryText };
  }

  static hydrate(data: { segments: TranscriptSegment[]; summary: string } | undefined): ConversationWindow {
    const window = new ConversationWindow();
    if (data) {
      window.segments = [...data.segments];
      window.summaryText = data.summary;
    }
    return window;
  }
}
