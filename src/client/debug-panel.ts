import type { TranscriptSegment } from "../shared/schema";
import type { SoundEngine } from "./sound-engine";

/**
 * Opt-in developer panel (?debug=1): manual cue triggers (local playback
 * only — nothing goes through the server policy) and a transcript feed.
 */
export class DebugPanel {
  private readonly log: HTMLUListElement;

  constructor(container: HTMLElement, cueIds: string[], sounds: SoundEngine) {
    const root = document.createElement("aside");
    root.className = "debug-panel";
    root.setAttribute("aria-label", "Debug panel");

    const cueHeader = document.createElement("h3");
    cueHeader.textContent = "manual cues (local)";
    const cueButtons = document.createElement("div");
    cueButtons.className = "cue-buttons";
    for (const id of cueIds) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = id;
      btn.addEventListener("click", () => sounds.play(id, 0.6, 0));
      cueButtons.appendChild(btn);
    }

    const logHeader = document.createElement("h3");
    logHeader.textContent = "events";
    this.log = document.createElement("ul");
    this.log.className = "log";

    root.append(cueHeader, cueButtons, logHeader, this.log);
    container.appendChild(root);
  }

  transcript(segments: TranscriptSegment[]): void {
    for (const seg of segments) {
      this.append(`${seg.speaker}: ${seg.text}`);
    }
  }

  append(text: string): void {
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString()} ${text}`;
    this.log.prepend(item);
    while (this.log.children.length > 60) this.log.lastChild?.remove();
  }
}
