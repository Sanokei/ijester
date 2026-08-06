import { showPrivacyModal } from "./permission-modal";

export interface ControlHandlers {
  onPauseToggle: (paused: boolean) => void;
  onMuteToggle: (muted: boolean) => void;
  onVolume: (volume: number) => void;
  onEnd: () => void;
}

/**
 * Minimal control surface: hidden until hover/focus/tap, fully keyboard
 * accessible. The volume button toggles mute on click and reveals its
 * slider on hover or keyboard focus. "End session" releases the microphone
 * in one action.
 */
export class Controls {
  private readonly root: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly volumeButton: HTMLButtonElement;
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

    // Volume group: button (click = mute toggle) + hover/focus slider.
    const volumeGroup = document.createElement("div");
    volumeGroup.className = "volume-group";

    this.volumeButton = button("🔊", "Mute reaction sounds");
    this.volumeButton.setAttribute("aria-pressed", "false");
    this.volumeButton.addEventListener("click", () => {
      this.setMuted(!this.muted);
      handlers.onMuteToggle(this.muted);
    });

    const pop = document.createElement("div");
    pop.className = "volume-pop";
    const sliderLabel = document.createElement("span");
    sliderLabel.className = "sr-only";
    sliderLabel.id = "volume-label";
    sliderLabel.textContent = "Reaction volume";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(initialVolume * 100));
    slider.setAttribute("aria-labelledby", "volume-label");
    slider.addEventListener("input", () => handlers.onVolume(Number(slider.value) / 100));
    pop.append(sliderLabel, slider);

    volumeGroup.append(this.volumeButton, pop);

    const privacyButton = button("Privacy", "How privacy works");
    privacyButton.addEventListener("click", () => showPrivacyModal());

    const endButton = button("End", "End session and release microphone");
    endButton.classList.add("end");
    endButton.addEventListener("click", () => handlers.onEnd());

    this.root.append(this.pauseButton, volumeGroup, privacyButton, endButton);
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
    this.volumeButton.textContent = muted ? "🔇" : "🔊";
    this.volumeButton.setAttribute("aria-pressed", String(muted));
    this.volumeButton.setAttribute(
      "aria-label",
      muted ? "Unmute reaction sounds" : "Mute reaction sounds",
    );
  }
}

function button(text: string, ariaLabel: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  el.setAttribute("aria-label", ariaLabel);
  return el;
}
