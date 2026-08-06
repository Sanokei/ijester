import type { IrisState } from "../shared/schema";

interface StateTarget {
  open: number;
  spinDps: number; // waveform rotation, degrees per second
  breathe: number; // amplitude of idle breathing
}

const STATE_TARGETS: Record<IrisState, StateTarget> = {
  idle: { open: 0.32, spinDps: 4, breathe: 0.05 },
  permission: { open: 0.45, spinDps: 6, breathe: 0.03 },
  connecting: { open: 0.4, spinDps: 40, breathe: 0.02 },
  listening: { open: 0.62, spinDps: 9, breathe: 0.04 },
  speech: { open: 0.78, spinDps: 14, breathe: 0.02 },
  evaluating: { open: 0.5, spinDps: 26, breathe: 0.01 },
  cueing: { open: 0.95, spinDps: 30, breathe: 0.02 },
  paused: { open: 0.08, spinDps: 1, breathe: 0.015 },
  error: { open: 0.25, spinDps: 2, breathe: 0.09 },
  ended: { open: 0.02, spinDps: 0, breathe: 0 },
};

/** Angular resolution of the volume waveform ring. */
const WAVE_BINS = 144;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Canvas-rendered iris: a detailed blue pupil inside a uniform orange iris
 * ring, with microphone volume history drawn as a brighter-orange radial
 * waveform inside the ring. Driven by semantic inputs only (state, mic
 * level, speech probability, cue impact).
 */
export class Iris {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private state: IrisState = "idle";
  private level = 0;
  private targetLevel = 0;
  private speechProb = 0;
  private open = 0.32;
  private pulse = 0;
  private impact = 0;
  private spin = 0;
  private wave = new Float32Array(WAVE_BINS);
  private waveHead = 0;
  private waveClock = 0;
  private lastFrame = 0;
  private rafId = 0;
  private readonly reducedMotion: boolean;

  constructor(container: HTMLElement) {
    this.element = document.createElement("button");
    this.element.className = "iris-stage";
    this.element.dataset["state"] = "idle";
    this.element.setAttribute("aria-label", "iJester iris. Activate to begin.");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "iris-canvas";
    const hint = document.createElement("span");
    hint.className = "iris-hint";
    hint.textContent = "tap the iris to begin";
    this.element.append(this.canvas, hint);
    container.appendChild(this.element);

    this.ctx = this.canvas.getContext("2d")!;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.resize();

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!this.reducedMotion) {
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame((t) => this.frame(t));
    } else {
      this.draw();
    }
  }

  setState(state: IrisState): void {
    if (this.state === state) return;
    this.state = state;
    this.element.dataset["state"] = state;
    if (state !== "idle") this.hideHint();
    if (this.reducedMotion) {
      this.open = STATE_TARGETS[state].open;
      this.pulse = state === "evaluating" ? 0.6 : 0;
      this.draw();
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
      this.draw();
      setTimeout(() => {
        this.impact = 0;
        this.draw();
      }, 450);
    }
  }

  hideHint(): void {
    this.element.querySelector(".iris-hint")?.setAttribute("hidden", "");
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
  }

  private resize(): void {
    const size = this.element.clientWidth;
    if (size === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    if (this.reducedMotion) this.draw();
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const target = STATE_TARGETS[this.state];

    const breathe = Math.sin(t / 1900) * target.breathe;
    const speechBoost =
      this.state === "listening" || this.state === "speech" ? this.speechProb * 0.12 : 0;
    this.open = lerp(this.open, target.open + breathe + speechBoost, 1 - Math.exp(-dt * 5));

    // Mic level with fast attack, slow release.
    const attack = this.targetLevel > this.level ? 22 : 6;
    this.level = lerp(this.level, this.targetLevel, 1 - Math.exp(-dt * attack));

    const pulseTarget =
      this.state === "evaluating" ? 0.5 + 0.5 * Math.abs(Math.sin(t / 260) ** 3) : 0;
    this.pulse = lerp(this.pulse, pulseTarget, 1 - Math.exp(-dt * 8));

    this.impact = Math.max(0, this.impact - dt * 2.4);
    this.spin = (this.spin + target.spinDps * dt) % 360;

    // Feed the waveform ring: ~90 samples/s written at the head so recent
    // audio wraps around the circle; everything decays slowly.
    this.waveClock += dt;
    while (this.waveClock > 1 / 90) {
      this.waveClock -= 1 / 90;
      this.waveHead = (this.waveHead + 1) % WAVE_BINS;
      this.wave[this.waveHead] = Math.min(1, this.level * (0.6 + this.speechProb * 0.7));
    }
    for (let i = 0; i < WAVE_BINS; i++) this.wave[i] = this.wave[i]! * (1 - dt * 0.55);

    this.draw();
    this.rafId = requestAnimationFrame((next) => this.frame(next));
  }

  // -------------------------------------------------------------- drawing

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    if (w === 0) return;
    const c = w / 2;
    const R = c * 0.96;

    // Paused/ended wash the color out; error warms and dims slightly.
    const desat = this.state === "paused" || this.state === "ended" ? 0.18 : 1;
    const col = (h: number, s: number, l: number, a = 1) =>
      `hsl(${h} ${Math.round(s * desat)}% ${l}% / ${a})`;

    const pupilR = R * (0.66 - this.open * 0.22 + this.pulse * 0.05 - this.impact * 0.08);
    const ringOuter = R * (0.9 + this.level * 0.02 + this.impact * 0.04);
    const ringInner = pupilR + R * 0.015;

    ctx.clearRect(0, 0, w, w);

    // Ambient glow.
    const glow = ctx.createRadialGradient(c, c, ringOuter * 0.7, c, c, R * 1.02);
    glow.addColorStop(0, col(30, 90, 60, 0.14 + this.level * 0.15 + this.impact * 0.3));
    glow.addColorStop(1, col(30, 90, 60, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, R * 1.02, 0, Math.PI * 2);
    ctx.fill();

    // Uniform orange iris ring.
    const ring = ctx.createRadialGradient(c, c, ringInner, c, c, ringOuter);
    ring.addColorStop(0, col(30, 62, 62));
    ring.addColorStop(0.55, col(26, 70, 55));
    ring.addColorStop(1, col(20, 74, 46));
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
    ctx.fill();

    // Faint static fibers for texture.
    ctx.save();
    ctx.translate(c, c);
    ctx.strokeStyle = col(18, 60, 38, 0.14);
    ctx.lineWidth = Math.max(1, w * 0.0016);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * ringInner, Math.sin(a) * ringInner);
      ctx.lineTo(Math.cos(a) * ringOuter * 0.985, Math.sin(a) * ringOuter * 0.985);
      ctx.stroke();
    }
    ctx.restore();

    // Volume waveform: brighter orange spikes inside the ring, newest at
    // the rotating head, wrapping around the circle.
    const ringWidth = ringOuter - ringInner;
    const spinRad = (this.spin * Math.PI) / 180;
    ctx.save();
    ctx.translate(c, c);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, (Math.PI * (ringInner + ringWidth * 0.4) * 2) / WAVE_BINS * 0.45);
    for (let k = 0; k < WAVE_BINS; k++) {
      const amp = this.wave[(this.waveHead - k + WAVE_BINS) % WAVE_BINS]! * Math.min(1, this.open + 0.15);
      if (amp < 0.015) continue;
      const a = spinRad + (k / WAVE_BINS) * Math.PI * 2;
      const base = ringInner + ringWidth * 0.08;
      const len = ringWidth * 0.8 * amp + this.impact * ringWidth * 0.1;
      ctx.strokeStyle = col(35, 100, 62, 0.3 + amp * 0.65);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * base, Math.sin(a) * base);
      ctx.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len));
      ctx.stroke();
    }
    ctx.restore();

    // Ring edge definition.
    ctx.strokeStyle = col(18, 70, 40, 0.35);
    ctx.lineWidth = Math.max(1, w * 0.003);
    ctx.beginPath();
    ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
    ctx.stroke();

    // ---------------------------------------------------------- pupil

    // Body: deep blue with an off-center light source.
    const pupil = ctx.createRadialGradient(
      c - pupilR * 0.25,
      c - pupilR * 0.3,
      pupilR * 0.1,
      c,
      c,
      pupilR,
    );
    pupil.addColorStop(0, col(214, 58, 44 + this.pulse * 8));
    pupil.addColorStop(0.45, col(219, 62, 30));
    pupil.addColorStop(0.85, col(224, 66, 18));
    pupil.addColorStop(1, col(228, 70, 12));
    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.arc(c, c, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // Radial striations, slowly counter-rotating.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-spinRad * 0.35);
    ctx.lineWidth = Math.max(1, w * 0.0014);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const inner = pupilR * (0.3 + (i % 3) * 0.08);
      ctx.strokeStyle = col(213, 55, 60, 0.06 + (i % 4 === 0 ? 0.05 : 0));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * pupilR * 0.94, Math.sin(a) * pupilR * 0.94);
      ctx.stroke();
    }
    ctx.restore();

    // Concentric detail rings.
    for (const [r, alpha] of [
      [0.35, 0.1],
      [0.62, 0.07],
      [0.85, 0.09],
    ] as const) {
      ctx.strokeStyle = col(212, 60, 62, alpha);
      ctx.lineWidth = Math.max(1, w * 0.0018);
      ctx.beginPath();
      ctx.arc(c, c, pupilR * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Limbal ring: bright blue rim where pupil meets the orange iris.
    ctx.strokeStyle = col(212, 75, 55, 0.5 + this.impact * 0.3);
    ctx.lineWidth = Math.max(1.5, w * 0.005);
    ctx.beginPath();
    ctx.arc(c, c, pupilR * 0.99, 0, Math.PI * 2);
    ctx.stroke();

    // Specular highlight.
    const spec = ctx.createRadialGradient(
      c - pupilR * 0.32,
      c - pupilR * 0.38,
      0,
      c - pupilR * 0.32,
      c - pupilR * 0.38,
      pupilR * 0.32,
    );
    spec.addColorStop(0, `hsl(0 0% 100% / ${0.5 + this.impact * 0.3})`);
    spec.addColorStop(1, "hsl(0 0% 100% / 0)");
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(c - pupilR * 0.32, c - pupilR * 0.38, pupilR * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}
