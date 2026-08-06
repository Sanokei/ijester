import { describe, expect, test } from "bun:test";
import { ConversationWindow } from "../durable-object/conversation-window";
import type { TranscriptSegment } from "../shared/schema";

function segment(id: string, startMs: number, endMs: number, text = "hello there", speaker: TranscriptSegment["speaker"] = "S1"): TranscriptSegment {
  return { id, speaker, text, startMs, endMs, final: true };
}

describe("conversation window", () => {
  test("keeps segments inside the hot window", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add([segment("a", 95_000, 96_000)], now);
    expect(w.hot()).toHaveLength(1);
  });

  test("evicts old segments into the summary", () => {
    const w = new ConversationWindow();
    w.add([segment("old", 1_000, 2_000, "ancient history")], 3_000);
    expect(w.hot()).toHaveLength(1);
    w.prune(100_000);
    expect(w.hot()).toHaveLength(0);
    expect(w.summary()).toContain("ancient history");
  });

  test("summary is capped", () => {
    const w = new ConversationWindow();
    for (let i = 0; i < 100; i++) {
      w.add([segment(`s${i}`, i * 1000, i * 1000 + 900, "a".repeat(120))], i * 1000 + 900);
    }
    w.prune(1_000_000);
    expect(w.summary().length).toBeLessThanOrEqual(1_601);
  });

  test("immediate window is narrower than hot window", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add([segment("older", 65_000, 66_000), segment("fresh", 95_000, 99_000)], now);
    expect(w.hot()).toHaveLength(2);
    const immediate = w.immediate(now);
    expect(immediate).toHaveLength(1);
    expect(immediate[0]!.id).toBe("fresh");
  });

  test("isCurrent tracks the immediate window", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add([segment("older", 65_000, 66_000), segment("fresh", 95_000, 99_000)], now);
    expect(w.isCurrent("fresh", now)).toBe(true);
    expect(w.isCurrent("older", now)).toBe(false);
    expect(w.isCurrent("nonexistent", now)).toBe(false);
  });

  test("non-final and empty segments are ignored", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add(
      [
        { ...segment("p", 95_000, 96_000), final: false },
        segment("empty", 95_000, 96_000, "   "),
      ],
      now,
    );
    expect(w.hot()).toHaveLength(0);
  });

  test("segments are ordered by start time", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add([segment("b", 96_000, 97_000)], now);
    w.add([segment("a", 94_000, 95_000)], now);
    expect(w.hot().map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("detects overlapping speech between different speakers", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add(
      [
        segment("a", 95_000, 98_000, "one", "S1"),
        segment("b", 96_500, 99_000, "two", "S2"),
      ],
      now,
    );
    expect(w.overlappingSpeech(now)).toBe(true);
  });

  test("serialize/hydrate round-trips", () => {
    const w = new ConversationWindow();
    const now = 100_000;
    w.add([segment("a", 95_000, 96_000)], now);
    const restored = ConversationWindow.hydrate(w.serialize());
    expect(restored.hot()).toHaveLength(1);
    expect(restored.hot()[0]!.id).toBe("a");
  });

  test("clear removes everything", () => {
    const w = new ConversationWindow();
    w.add([segment("a", 95_000, 96_000)], 100_000);
    w.clear();
    expect(w.hot()).toHaveLength(0);
    expect(w.summary()).toBe("");
  });
});
