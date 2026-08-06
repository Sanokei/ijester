import { describe, expect, test } from "bun:test";
import {
  evaluateProposal,
  hasSensitiveContext,
  type PolicyContext,
} from "../durable-object/reaction-policy";
import type { ReactionProposal } from "../shared/schema";

function proposal(overrides: Partial<ReactionProposal> = {}): ReactionProposal {
  return {
    cue: "ooo",
    confidence: 0.95,
    intensity: 1,
    delay_ms: 200,
    reason_code: "romantic_reveal",
    target_segment_id: "seg_1",
    ...overrides,
  };
}

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    nowMs: 100_000,
    mode: "standard",
    muted: false,
    minIntervalMs: 2500,
    nextAllowedCueAtMs: 0,
    recentCues: [],
    cuesPlayedThisSession: 0,
    recentText: "and then she said yes",
    currentSegmentIds: new Set(["seg_1", "seg_2"]),
    ...overrides,
  };
}

describe("policy gate", () => {
  test("allows a clean high-confidence proposal", () => {
    const decision = evaluateProposal(proposal(), ctx());
    expect(decision.allowed).toBe(true);
    expect(decision.cue).toBe("ooo");
    expect(decision.gain).toBeGreaterThan(0);
    expect(decision.gain).toBeLessThanOrEqual(0.9);
  });

  test("none proposal never fires", () => {
    const decision = evaluateProposal(proposal({ cue: "none" }), ctx());
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("proposed_none");
  });

  test("unknown cue is rejected", () => {
    const decision = evaluateProposal(proposal({ cue: "vine_boom" }), ctx());
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("unknown_cue");
  });

  test("below per-cue confidence threshold is rejected", () => {
    // ooo requires 0.86
    const decision = evaluateProposal(proposal({ confidence: 0.85 }), ctx());
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("below_confidence_threshold");
  });

  test("negative cues are disabled outside full mode", () => {
    const decision = evaluateProposal(
      proposal({ cue: "boo_soft", confidence: 0.99 }),
      ctx({ mode: "standard" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("cue_disabled_in_mode");
  });

  test("negative cues allowed in full mode with very high confidence", () => {
    const decision = evaluateProposal(
      proposal({ cue: "boo_soft", confidence: 0.95 }),
      ctx({ mode: "full" }),
    );
    expect(decision.allowed).toBe(true);
  });

  test("comedy cues are disabled in minimal mode", () => {
    const decision = evaluateProposal(
      proposal({ cue: "laugh_light", confidence: 0.99 }),
      ctx({ mode: "minimal" }),
    );
    expect(decision.allowed).toBe(false);
  });

  test("muted session suppresses everything", () => {
    const decision = evaluateProposal(proposal(), ctx({ muted: true }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("muted");
  });

  test("global cooldown blocks", () => {
    const decision = evaluateProposal(proposal(), ctx({ nextAllowedCueAtMs: 200_000 }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("global_cooldown");
  });

  test("per-cue cooldown blocks a recent repeat", () => {
    const decision = evaluateProposal(
      proposal(),
      ctx({
        recentCues: [{ cue: "ooo", reasonCode: "other", atMs: 95_000 }],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("cue_cooldown");
  });

  test("duplicate moment (same cue + reason) within a minute is suppressed", () => {
    const decision = evaluateProposal(
      proposal(),
      ctx({
        recentCues: [{ cue: "ooo", reasonCode: "romantic_reveal", atMs: 50_000 }],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("duplicate_moment");
  });

  test("stale target segment is rejected", () => {
    const decision = evaluateProposal(
      proposal({ target_segment_id: "seg_gone" }),
      ctx(),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("stale_target_segment");
  });

  test("missing target segment is rejected", () => {
    const decision = evaluateProposal(proposal({ target_segment_id: "" }), ctx());
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("missing_target_segment");
  });

  test("sensitive context suppresses all cues", () => {
    const decision = evaluateProposal(
      proposal(),
      ctx({ recentText: "my grandmother passed away last night" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("sensitive_context");
  });

  test("session cue budget caps total plays", () => {
    const decision = evaluateProposal(proposal(), ctx({ cuesPlayedThisSession: 60 }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("session_cue_budget");
  });

  test("per-cue session budget caps repeats", () => {
    const plays = Array.from({ length: 20 }, (_, i) => ({
      cue: "ooo",
      reasonCode: `r${i}`,
      atMs: i * 100,
    }));
    const decision = evaluateProposal(proposal(), ctx({ recentCues: plays }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("cue_session_budget");
  });

  test("gain is clamped regardless of intensity", () => {
    const decision = evaluateProposal(proposal({ intensity: 3 }), ctx());
    expect(decision.allowed).toBe(true);
    expect(decision.gain).toBeLessThanOrEqual(0.9);
  });

  test("delay is clamped to a safe range", () => {
    const decision = evaluateProposal(proposal({ delay_ms: 1200 }), ctx());
    expect(decision.delayMs).toBeLessThanOrEqual(1200);
  });
});

describe("sensitive context detector", () => {
  test.each([
    "he was rushed to the ER last night",
    "she got diagnosed with cancer",
    "they fired me this morning",
    "I've been thinking about suicide",
    "someone got stabbed outside",
  ])("flags: %s", (text) => {
    expect(hasSensitiveContext(text)).toBe(true);
  });

  test.each([
    "and then the cat knocked the cake off the table",
    "I fully checked in as Kevin",
    "that movie was killer",
  ])("passes: %s", (text) => {
    expect(hasSensitiveContext(text)).toBe(false);
  });
});
