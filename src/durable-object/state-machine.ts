/**
 * Session lifecycle. The DO keeps a coarse phase; the client derives finer
 * visual states (speech level, cue impact) locally from its own microphone.
 */
export type SessionPhase =
  | "connecting"
  | "listening"
  | "evaluating"
  | "cueing"
  | "paused"
  | "ended";

const TRANSITIONS: Record<SessionPhase, readonly SessionPhase[]> = {
  connecting: ["listening", "ended"],
  listening: ["evaluating", "cueing", "paused", "ended"],
  evaluating: ["listening", "cueing", "paused", "ended"],
  cueing: ["listening", "evaluating", "paused", "ended"],
  paused: ["listening", "ended"],
  ended: [],
};

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Apply a transition, returning the phase actually in effect afterwards. */
export function transition(from: SessionPhase, to: SessionPhase): SessionPhase {
  return canTransition(from, to) ? to : from;
}
