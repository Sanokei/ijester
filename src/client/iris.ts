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
    // Every catalog color passes through here, so softening happens in one
    // place: saturation eases down and lightness lifts toward white.
    const col = (h: number, s: number, l: number, a = 1) =>
      `hsl(${h} ${Math.round(s * 0.66 * desat)}% ${Math.round(l + (100 - l) * 0.14)}% / ${a})`;

    const pupilR = R * (0.52 - this.open * 0.16 + this.pulse * 0.04 - this.impact * 0.06);
    const ringOuter = R * (0.9 + this.level * 0.02 + this.impact * 0.04);
    const ringInner = pupilR + R * 0.012;
    const hash = (i: number) => (((i * 2654435761) >>> 0) % 1000) / 1000;

    ctx.clearRect(0, 0, w, w);

    // Ambient warm glow.
    const glow = ctx.createRadialGradient(c, c, ringOuter * 0.7, c, c, R * 1.02);
    glow.addColorStop(0, col(30, 90, 60, 0.12 + this.level * 0.14 + this.impact * 0.3));
    glow.addColorStop(1, col(30, 90, 60, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, R * 1.02, 0, Math.PI * 2);
    ctx.fill();

    // Iris ring: amber body, lighter near the pupil, deepening outward.
    const ring = ctx.createRadialGradient(c, c, pupilR * 0.9, c, c, ringOuter);
    ring.addColorStop(0, col(33, 58, 68));
    ring.addColorStop(0.35, col(29, 66, 58));
    ring.addColorStop(0.75, col(24, 70, 48));
    ring.addColorStop(1, col(17, 66, 36));
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
    ctx.fill();

    // Organic fibers: two counter-drifting layers with varied lengths.
    const spinRad = (this.spin * Math.PI) / 180;
    ctx.save();
    ctx.translate(c, c);
    for (const [count, drift, alphaBase] of [
      [96, spinRad * 0.12, 0.1],
      [64, -spinRad * 0.07, 0.07],
    ] as const) {
      ctx.lineWidth = Math.max(1, w * 0.0014);
      for (let i = 0; i < count; i++) {
        const a = drift + (i / count) * Math.PI * 2;
        const jitter = hash(i * 7 + count);
        const start = ringInner + (ringOuter - ringInner) * 0.06 * jitter;
        const end = ringOuter * (0.9 + jitter * 0.07);
        ctx.strokeStyle = col(20 + jitter * 12, 62, 34, alphaBase + jitter * 0.08);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * start, Math.sin(a) * start);
        ctx.lineTo(Math.cos(a) * end, Math.sin(a) * end);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Volume waveform inside the ring: a soft wide glow pass under a
    // bright crisp pass, newest audio at the rotating head.
    const ringWidth = ringOuter - ringInner;
    ctx.save();
    ctx.translate(c, c);
    ctx.lineCap = "round";
    for (const [widthScale, alphaScale, lightness] of [
      [1.9, 0.28, 66],
      [0.75, 1, 62],
    ] as const) {
      ctx.lineWidth = Math.max(1.2, ((Math.PI * (ringInner + ringWidth * 0.4) * 2) / WAVE_BINS) * 0.45 * widthScale);
      for (let k = 0; k < WAVE_BINS; k++) {
        const amp = this.wave[(this.waveHead - k + WAVE_BINS) % WAVE_BINS]! * Math.min(1, this.open + 0.15);
        if (amp < 0.02) continue;
        const a = spinRad + (k / WAVE_BINS) * Math.PI * 2;
        const base = ringInner + ringWidth * 0.06;
        const len = ringWidth * 0.78 * amp + this.impact * ringWidth * 0.1;
        ctx.strokeStyle = col(36, 100, lightness, (0.3 + amp * 0.6) * alphaScale);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * base, Math.sin(a) * base);
        ctx.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len));
        ctx.stroke();
      }
    }
    ctx.restore();

    // Top-light and lower shade: gives the disc a gentle dome.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
    ctx.clip();
    const domeLight = ctx.createRadialGradient(c, c - R * 0.55, 0, c, c - R * 0.55, R * 1.1);
    domeLight.addColorStop(0, "hsl(40 100% 96% / 0.16)");
    domeLight.addColorStop(0.5, "hsl(40 100% 96% / 0)");
    ctx.fillStyle = domeLight;
    ctx.fillRect(0, 0, w, w);
    const domeShade = ctx.createRadialGradient(c, c + R * 0.7, R * 0.2, c, c + R * 0.7, R * 1.1);
    domeShade.addColorStop(0, "hsl(15 60% 12% / 0.14)");
    domeShade.addColorStop(1, "hsl(15 60% 12% / 0)");
    ctx.fillStyle = domeShade;
    ctx.fillRect(0, 0, w, w);
    ctx.restore();

    // Outer rim vignette instead of a hard stroke.
    const rim = ctx.createRadialGradient(c, c, ringOuter * 0.82, c, c, ringOuter);
    rim.addColorStop(0, col(16, 70, 26, 0));
    rim.addColorStop(1, col(16, 70, 22, 0.5));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
    ctx.fill();

    // ---------------------------------------------------------- pupil

    // Limbal band: a soft dark transition from iris into pupil.
    const limbal = ctx.createRadialGradient(c, c, pupilR * 0.86, c, c, pupilR * 1.12);
    limbal.addColorStop(0, col(226, 60, 10, 0));
    limbal.addColorStop(0.5, col(226, 60, 10, 0.55));
    limbal.addColorStop(1, col(226, 60, 10, 0));
    ctx.fillStyle = limbal;
    ctx.beginPath();
    ctx.arc(c, c, pupilR * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Body: deep blue with an off-center light source.
    const pupil = ctx.createRadialGradient(
      c - pupilR * 0.3,
      c - pupilR * 0.34,
      pupilR * 0.08,
      c,
      c,
      pupilR,
    );
    pupil.addColorStop(0, col(211, 64, 52 + this.pulse * 8));
    pupil.addColorStop(0.35, col(216, 68, 36));
    pupil.addColorStop(0.7, col(222, 70, 22));
    pupil.addColorStop(1, col(227, 74, 11));
    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.arc(c, c, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // Blue iris texture: varied radial filaments, slowly counter-rotating.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-spinRad * 0.35);
    ctx.lineWidth = Math.max(1, w * 0.0014);
    for (let i = 0; i < 84; i++) {
      const a = (i / 84) * Math.PI * 2;
      const jitter = hash(i * 13 + 5);
      const inner = pupilR * (0.22 + jitter * 0.24);
      const outer = pupilR * (0.8 + jitter * 0.16);
      ctx.strokeStyle = col(206 + jitter * 22, 62, 58, 0.05 + jitter * 0.11);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();

    // Concentric ripples.
    for (const [r, alpha] of [
      [0.3, 0.12],
      [0.52, 0.08],
      [0.72, 0.09],
      [0.9, 0.12],
    ] as const) {
      ctx.strokeStyle = col(210, 62, 60, alpha);
      ctx.lineWidth = Math.max(1, w * 0.0016);
      ctx.beginPath();
      ctx.arc(c, c, pupilR * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Inner core: a darker center that tightens while evaluating.
    const coreR = pupilR * (0.34 + this.pulse * 0.06);
    const core = ctx.createRadialGradient(c, c, 0, c, c, coreR);
    core.addColorStop(0, col(228, 70, 7));
    core.addColorStop(0.55, col(228, 70, 8, 0.85));
    core.addColorStop(0.85, col(228, 70, 10, 0.4));
    core.addColorStop(1, col(228, 70, 10, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, coreR, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlights: one crisp key light, one faint counter-glint.
    const key = ctx.createRadialGradient(
      c - pupilR * 0.38, c - pupilR * 0.44, 0,
      c - pupilR * 0.38, c - pupilR * 0.44, pupilR * 0.2,
    );
    key.addColorStop(0, `hsl(0 0% 100% / ${0.6 + this.impact * 0.2})`);
    key.addColorStop(0.35, "hsl(0 0% 100% / 0.22)");
    key.addColorStop(1, "hsl(0 0% 100% / 0)");
    ctx.fillStyle = key;
    ctx.beginPath();
    ctx.arc(c - pupilR * 0.38, c - pupilR * 0.44, pupilR * 0.2, 0, Math.PI * 2);
    ctx.fill();
    const glint = ctx.createRadialGradient(
      c + pupilR * 0.4, c + pupilR * 0.42, 0,
      c + pupilR * 0.4, c + pupilR * 0.42, pupilR * 0.14,
    );
    glint.addColorStop(0, "hsl(205 80% 80% / 0.22)");
    glint.addColorStop(1, "hsl(205 80% 80% / 0)");
    ctx.fillStyle = glint;
    ctx.beginPath();
    ctx.arc(c + pupilR * 0.4, c + pupilR * 0.42, pupilR * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}
