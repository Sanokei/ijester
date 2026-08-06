import { showPrivacyModal } from "./permission-modal";

export interface ControlHandlers {
  onPauseToggle: (paused: boolean) => void;
  onMuteToggle: (muted: boolean) => void;
  onVolume: (volume: number) => void;
  onEnd: () => void;
}

/**
 * Minimal control surface: hidden until hover/focus/tap, fully keyboard
 * accessible. "End session" releases the microphone in one action.
 */
export class Controls {
  private readonly root: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;
  private paused = false;
  private muted = false;

  constructor(container: HTMLElement, initialVolume: number, handlers: ControlHandlers) {
    this.root = document.createElement("div");
    this.root.className = "controls";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "Session controls");
    this.root.hidden = true;

    this.pauseButton = button("Pause", "Pause listening");
    this.pauseButton.addEventListener("click", () => {
      this.setPaused(!this.paused);
      handlers.onPauseToggle(this.paused);
    });

    this.muteButton = button("Mute", "Mute reaction sounds");
    this.muteButton.setAttribute("aria-pressed", "false");
    this.muteButton.addEventListener("click", () => {
      this.setMuted(!this.muted);
      handlers.onMuteToggle(this.muted);
    });

    const volumeWrap = document.createElement("label");
    volumeWrap.className = "volume";
    const volumeText = document.createElement("span");
    volumeText.className = "sr-only";
    volumeText.textContent = "Reaction volume";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(initialVolume * 100));
    slider.addEventListener("input", () => handlers.onVolume(Number(slider.value) / 100));
    volumeWrap.append(volumeText, "🔉", slider);

    const privacyButton = button("Privacy", "How privacy works");
    privacyButton.addEventListener("click", () => showPrivacyModal());

    const endButton = button("End", "End session and release microphone");
    endButton.classList.add("end");
    endButton.addEventListener("click", () => handlers.onEnd());

    this.root.append(this.pauseButton, this.muteButton, volumeWrap, privacyButton, endButton);
    container.appendChild(this.root);

    // Tap anywhere reveals controls briefly on touch devices.
    let hideTimer: number | undefined;
    window.addEventListener("pointerdown", () => {
      document.body.classList.add("controls-visible");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(
        () => document.body.classList.remove("controls-visible"),
        3500,
      );
    });
  }

  show(): void {
    this.root.hidden = false;
    document.body.classList.add("controls-visible");
    setTimeout(() => document.body.classList.remove("controls-visible"), 4000);
  }

  hide(): void {
    this.root.hidden = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseButton.textContent = paused ? "Resume" : "Pause";
    this.pauseButton.setAttribute(
      "aria-label",
      paused ? "Resume listening" : "Pause listening",
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.muteButton.textContent = muted ? "Unmute" : "Mute";
    this.muteButton.setAttribute("aria-pressed", String(muted));
  }
}

function button(text: string, ariaLabel: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  el.setAttribute("aria-label", ariaLabel);
  return el;
}
