import type { IrisState } from "../shared/schema";

const STATE_DESCRIPTIONS: Record<IrisState, string> = {
  idle: "Idle. Activate the iris to begin.",
  permission: "Waiting for microphone permission.",
  connecting: "Connecting.",
  listening: "Listening to the room.",
  speech: "Hearing speech.",
  evaluating: "Considering a reaction.",
  cueing: "Playing a reaction.",
  paused: "Paused. Microphone is not being processed.",
  error: "Something went wrong. Still trying.",
  ended: "Session ended.",
};

/**
 * Throttled status announcements: a visible subdued label updated freely,
 * and an aria-live region updated at most every few seconds so screen
 * readers aren't flooded by rapid state flips.
 */
export class StatusAnnouncer {
  private readonly label: HTMLElement;
  private readonly live: HTMLElement;
  private lastAnnounced = "";
  private lastAnnouncedAt = 0;
  private pendingTimer: number | undefined;

  constructor(container: HTMLElement) {
    this.label = document.createElement("div");
    this.label.className = "status-label";
    this.label.setAttribute("aria-hidden", "true");

    this.live = document.createElement("div");
    this.live.className = "sr-only";
    this.live.setAttribute("role", "status");
    this.live.setAttribute("aria-live", "polite");

    container.append(this.label, this.live);
  }

  setState(state: IrisState): void {
    const text = STATE_DESCRIPTIONS[state];
    this.label.textContent = state;
    this.announce(text);
  }

  notice(text: string): void {
    this.label.textContent = text;
    this.announce(text);
  }

  private announce(text: string): void {
    if (text === this.lastAnnounced) return;
    const now = Date.now();
    const wait = Math.max(0, 3000 - (now - this.lastAnnouncedAt));
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      this.live.textContent = text;
      this.lastAnnounced = text;
      this.lastAnnouncedAt = Date.now();
    }, wait);
  }
}
