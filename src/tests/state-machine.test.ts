import { describe, expect, test } from "bun:test";
import { canTransition, transition } from "../durable-object/state-machine";

describe("session state machine", () => {
  test("normal lifecycle", () => {
    expect(canTransition("connecting", "listening")).toBe(true);
    expect(canTransition("listening", "evaluating")).toBe(true);
    expect(canTransition("evaluating", "cueing")).toBe(true);
    expect(canTransition("cueing", "listening")).toBe(true);
    expect(canTransition("listening", "paused")).toBe(true);
    expect(canTransition("paused", "listening")).toBe(true);
    expect(canTransition("listening", "ended")).toBe(true);
  });

  test("ended is terminal", () => {
    expect(canTransition("ended", "listening")).toBe(false);
    expect(canTransition("ended", "connecting")).toBe(false);
    expect(transition("ended", "listening")).toBe("ended");
  });

  test("paused cannot jump straight to cueing", () => {
    expect(canTransition("paused", "cueing")).toBe(false);
    expect(transition("paused", "cueing")).toBe("paused");
  });

  test("self transitions are allowed", () => {
    expect(transition("listening", "listening")).toBe("listening");
  });
});
