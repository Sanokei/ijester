/**
 * Generates the placeholder reaction sounds as 16-bit mono WAV files in
 * public/sounds/, plus the client manifest. Everything is synthesized from
 * scratch, so the assets are license-clean (CC0). Production should replace
 * these with licensed recordings — the manifest structure stays the same.
 *
 * Run: bun scripts/generate-sounds.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds");

// ---------------------------------------------------------------- helpers

function render(durationSec, fn) {
  const samples = new Float64Array(Math.floor(RATE * durationSec));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = fn(i / RATE, i);
  }
  return samples;
}

function mix(...layers) {
  const length = Math.max(...layers.map((l) => l.length));
  const out = new Float64Array(length);
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i++) out[i] += layer[i];
  }
  return out;
}

/** Exponential decay envelope. */
const decay = (t, rate) => Math.exp(-t * rate);
/** Attack-decay envelope with soft attack. */
const ad = (t, attack, rate) => (1 - Math.exp(-t / attack)) * Math.exp(-t * rate);

let noiseState = 22222;
function noise() {
  // Deterministic LCG so builds are reproducible.
  noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
  return noiseState / 2 ** 31 - 1;
}

/** One-pole lowpass over a sample array. */
function lowpass(samples, cutoffHz) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / RATE);
  let y = 0;
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    y += alpha * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(samples, cutoffHz) {
  const low = lowpass(samples, cutoffHz);
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - low[i];
  return out;
}

function normalize(samples, peak = 0.85) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max === 0) return samples;
  const gain = peak / max;
  return samples.map((s) => s * gain);
}

function fadeEdges(samples, ms = 8) {
  const n = Math.floor((RATE * ms) / 1000);
  for (let i = 0; i < n && i < samples.length; i++) {
    const g = i / n;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
  return samples;
}

function writeWav(name, samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcm);
  writeFileSync(join(OUT_DIR, name), Buffer.from(buffer));
  console.log(`wrote ${name} (${(dataSize / 1024).toFixed(0)} KB)`);
}

const sin = (f, t) => Math.sin(2 * Math.PI * f * t);

// ------------------------------------------------------------------ cues

/** Staccato bouncing "ha-ha" figure. */
function laugh(noteCount, baseFreq, noteMs, wobble) {
  const noteSec = noteMs / 1000;
  const total = noteCount * noteSec + 0.4;
  const pitches = [];
  for (let i = 0; i < noteCount; i++) {
    pitches.push(baseFreq * (1 - i * 0.045) * (1 + (i % 2 ? -wobble : wobble)));
  }
  return render(total, (t) => {
    const idx = Math.floor(t / noteSec);
    if (idx >= noteCount) return 0;
    const local = t - idx * noteSec;
    const f = pitches[idx];
    const env = ad(local, 0.004, 18);
    const body = sin(f, local) * 0.7 + sin(f * 2, local) * 0.25 + sin(f * 2.98, local) * 0.1;
    const breath = noise() * 0.12 * decay(local, 30);
    return (body + breath) * env * (0.75 + 0.25 * Math.sin(idx));
  });
}

function laughLight() {
  return laugh(5, 540, 130, 0.02);
}

function laughBig() {
  const figure = laugh(9, 460, 120, 0.035);
  const crowd = lowpass(
    render(1.6, (t) => noise() * ad(t, 0.15, 2.2) * 0.5),
    900,
  );
  return mix(figure, crowd);
}

function ooo() {
  // Slow swelling chord gliding gently upward — an intrigued crowd.
  return render(1.4, (t) => {
    const glide = 1 + 0.06 * Math.min(1, t / 1.1);
    const env = ad(t, 0.22, 2.2);
    const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.2 * t);
    let s = 0;
    for (const f of [220, 277.2, 329.6]) {
      s += sin(f * glide * vib, t) + 0.4 * sin(f * 2 * glide * vib, t);
    }
    return s * env * 0.22;
  });
}

function aww() {
  // Warm descending glide, like a sympathetic sigh.
  return render(1.5, (t) => {
    const glide = 1 - 0.16 * Math.min(1, t / 1.2);
    const env = ad(t, 0.18, 2.0);
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 4.5 * t);
    let s = 0;
    for (const f of [329.6, 415.3, 493.9]) {
      s += sin(f * glide * vib, t) + 0.3 * sin(f * 2 * glide * vib, t);
    }
    return s * env * 0.22;
  });
}

function gasp() {
  // A sharp collective inhale: rising filtered noise, cut short.
  const raw = render(0.55, (t) => {
    const env = Math.min(1, t / 0.4) ** 1.6 * (t < 0.5 ? 1 : decay(t - 0.5, 60));
    return noise() * env;
  });
  return highpass(lowpass(raw, 3800), 700);
}

function booSoft() {
  return render(1.3, (t) => {
    const f = 130 - 28 * Math.min(1, t / 1.1);
    const rough = 1 + 0.18 * Math.sin(2 * Math.PI * 13 * t);
    const env = ad(t, 0.12, 2.6);
    const s = sin(f, t) * 0.6 + sin(f * 1.5, t) * 0.25 + sin(f * 2, t) * 0.18;
    return s * rough * env * 0.7;
  });
}

function dramaticImpact() {
  const sub = render(1.9, (t) => {
    const f = 58 * (1 - 0.25 * Math.min(1, t / 1.5));
    return sin(f, t) * decay(t, 2.1);
  });
  const punch = render(0.12, (t) => noise() * decay(t, 55) * 0.8);
  const tail = lowpass(
    render(1.9, (t) => noise() * decay(t, 3.4) * 0.35),
    1400,
  );
  return mix(sub, punch, tail);
}

function knifeSting() {
  return render(1.0, (t) => {
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 15 * t);
    const env = ad(t, 0.005, 4.2);
    let s = 0;
    for (const f of [1760, 1865, 2093]) s += sin(f * (1 + 0.002 * Math.sin(2 * Math.PI * 7 * t)), t);
    return s * trem * env * 0.28;
  });
}

// ---------------------------------------------------------------- output

mkdirSync(OUT_DIR, { recursive: true });

const SOUNDS = [
  { id: "laugh_light", file: "laugh-light.wav", gen: laughLight, defaultGain: 0.5 },
  { id: "laugh_big", file: "laugh-big.wav", gen: laughBig, defaultGain: 0.55 },
  { id: "ooo", file: "ooo.wav", gen: ooo, defaultGain: 0.58 },
  { id: "aww", file: "aww.wav", gen: aww, defaultGain: 0.55 },
  { id: "gasp", file: "gasp.wav", gen: gasp, defaultGain: 0.55 },
  { id: "boo_soft", file: "boo-soft.wav", gen: booSoft, defaultGain: 0.45 },
  { id: "dramatic_impact", file: "dramatic-impact.wav", gen: dramaticImpact, defaultGain: 0.6 },
  { id: "knife_sting", file: "knife-sting.wav", gen: knifeSting, defaultGain: 0.5 },
];

for (const sound of SOUNDS) {
  writeWav(sound.file, fadeEdges(normalize(sound.gen())));
}

const manifest = {
  version: "v1",
  license: "All files synthesized by scripts/generate-sounds.mjs (CC0 placeholders).",
  sounds: SOUNDS.map(({ id, file, defaultGain }) => ({
    id,
    file: `/sounds/${file}`,
    defaultGain,
  })),
};
writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("wrote manifest.json");
