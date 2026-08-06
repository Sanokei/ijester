import { describe, expect, test } from "bun:test";
import { PcmAggregator } from "../durable-object/audio-aggregator";
import { pcm16ToWav } from "../shared/wav";

const packet = (ms: number) => new Uint8Array((16_000 * 2 * ms) / 1000);

describe("pcm aggregator", () => {
  test("flushes after speech followed by a pause", () => {
    const agg = new PcmAggregator();
    for (let i = 0; i < 4; i++) agg.add(packet(256), 256, true); // ~1s speech
    expect(agg.shouldFlush()).toBe(false);
    for (let i = 0; i < 3; i++) agg.add(packet(256), 256, false); // ~768ms pause
    expect(agg.shouldFlush()).toBe(true);
    const flushed = agg.flush()!;
    expect(flushed.durationMs).toBeGreaterThan(1500);
    expect(flushed.speechMs).toBeGreaterThanOrEqual(1000);
    expect(agg.buffered()).toBe(0);
  });

  test("flushes when the window fills even without a pause", () => {
    const agg = new PcmAggregator();
    for (let i = 0; i < 12; i++) agg.add(packet(256), 256, true); // ~3s
    expect(agg.shouldFlush()).toBe(true);
  });

  test("silence-only audio is discarded, never transcribed", () => {
    const agg = new PcmAggregator();
    for (let i = 0; i < 14; i++) agg.add(packet(256), 256, false);
    expect(agg.shouldFlush()).toBe(false);
    expect(agg.buffered()).toBe(0); // discarded once past the window size
  });

  test("brief noise below the speech minimum does not flush", () => {
    const agg = new PcmAggregator();
    agg.add(packet(256), 256, true);
    for (let i = 0; i < 4; i++) agg.add(packet(256), 256, false);
    expect(agg.shouldFlush()).toBe(false);
  });

  test("buffer is bounded even if flushing stalls", () => {
    const agg = new PcmAggregator();
    for (let i = 0; i < 100; i++) agg.add(packet(256), 256, true);
    expect(agg.buffered()).toBeLessThanOrEqual(10_500);
  });
});

describe("wav container", () => {
  test("wraps pcm with a valid RIFF header", () => {
    const pcm = new Uint8Array(32_000); // 1s of 16kHz mono
    const wav = pcm16ToWav(pcm, 16_000);
    const view = new DataView(wav);
    expect(wav.byteLength).toBe(44 + 32_000);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000); // sample rate
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(40, true)).toBe(32_000); // data size
  });
});
