import type { IrisState } from "../shared/schema";

interface StateTarget {
  open: number;
  spinDps: number; // fiber rotation, degrees per second
  breathe: number; // amplitude of idle breathing
}

const STATE_TARGETS: Record<IrisState, StateTarget> = {
  idle: { open: 0.32, spinDps: 2, breathe: 0.05 },
  permission: { open: 0.45, spinDps: 3, breathe: 0.03 },
  connecting: { open: 0.4, spinDps: 24, breathe: 0.02 },
  listening: { open: 0.62, spinDps: 5, breathe: 0.04 },
  speech: { open: 0.78, spinDps: 9, breathe: 0.02 },
  evaluating: { open: 0.5, spinDps: 14, breathe: 0.01 },
  cueing: { open: 0.95, spinDps: 18, breathe: 0.02 },
  paused: { open: 0.08, spinDps: 0.5, breathe: 0.015 },
  error: { open: 0.25, spinDps: 1, breathe: 0.09 },
  ended: { open: 0.02, spinDps: 0, breathe: 0 },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The iris drives itself from semantic inputs: state, mic level, speech
 * probability, thinking pulse, cue impact. It writes CSS custom properties;
 * all shape/color lives in styles.css.
 */
export class Iris {
  readonly element: HTMLElement;
  private state: IrisState = "idle";
  private level = 0;
  private targetLevel = 0;
  private speechProb = 0;
  private open = 0.32;
  private pulse = 0;
  private impact = 0;
  private spin = 0;
  private lastFrame = 0;
  private rafId = 0;
  private readonly reducedMotion: boolean;

  constructor(container: HTMLElement) {
    this.element = document.createElement("button");
    this.element.className = "iris-stage";
    this.element.dataset["state"] = "idle";
    this.element.setAttribute("aria-label", "iJester iris. Activate to begin.");
    this.element.innerHTML = `
      <div class="iris-glow"></div>
      <div class="iris-body"></div>
      <div class="iris-fibers"></div>
      <div class="iris-pupil"></div>
      <div class="iris-highlight"></div>
      <span class="iris-hint">tap the iris to begin</span>
    `;
    container.appendChild(this.element);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!this.reducedMotion) {
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame((t) => this.frame(t));
    } else {
      this.applyVars();
    }
  }

  setState(state: IrisState): void {
    if (this.state === state) return;
    this.state = state;
    this.element.dataset["state"] = state;
    if (state !== "idle") this.hideHint();
    if (this.reducedMotion) {
      // Discrete steps instead of continuous animation.
      this.open = STATE_TARGETS[state].open;
      this.pulse = state === "evaluating" ? 0.6 : 0;
      this.applyVars();
    }
  }

  getState(): IrisState {
    return this.state;
  }

  setMicLevel(level: number, speechProb: number): void {
    this.targetLevel = Math.min(1, level);
    this.speechProb = speechProb;
  }

  /** Called when a cue actually starts playing. */
  cueImpact(): void {
    this.impact = 1;
    if (this.reducedMotion) {
      this.applyVars();
      setTimeout(() => {
        this.impact = 0;
        this.applyVars();
      }, 450);
    }
  }

  hideHint(): void {
    this.element.querySelector(".iris-hint")?.setAttribute("hidden", "");
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const target = STATE_TARGETS[this.state];

    // Breathing + state-driven openness.
    const breathe = Math.sin(t / 1900) * target.breathe;
    const speechBoost = this.state === "listening" || this.state === "speech" ? this.speechProb * 0.12 : 0;
    this.open = lerp(this.open, target.open + breathe + speechBoost, 1 - Math.exp(-dt * 5));

    // Mic level with fast attack, slow release.
    const attack = this.targetLevel > this.level ? 22 : 5;
    this.level = lerp(this.level, this.targetLevel, 1 - Math.exp(-dt * attack));

    // Evaluating: short asymmetric pulses.
    const pulseTarget =
      this.state === "evaluating" ? 0.5 + 0.5 * Math.abs(Math.sin(t / 260) ** 3) : 0;
    this.pulse = lerp(this.pulse, pulseTarget, 1 - Math.exp(-dt * 8));

    // Cue impact decays quickly.
    this.impact = Math.max(0, this.impact - dt * 2.4);

    this.spin = (this.spin + target.spinDps * dt) % 360;

    this.applyVars();
    this.rafId = requestAnimationFrame((next) => this.frame(next));
  }

  private applyVars(): void {
    const s = this.element.style;
    s.setProperty("--open", this.open.toFixed(3));
    s.setProperty("--level", this.level.toFixed(3));
    s.setProperty("--pulse", this.pulse.toFixed(3));
    s.setProperty("--impact", this.impact.toFixed(3));
    s.setProperty("--spin", `${this.spin.toFixed(2)}deg`);
  }
}
