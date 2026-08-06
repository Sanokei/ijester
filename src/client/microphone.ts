/**
 * Microphone capture: level metering + voice-gated utterance recording.
 *
 * A fresh MediaRecorder is started for every utterance so each emitted blob
 * is a complete, standalone container (chunked MediaRecorder output after
 * the first slice lacks headers, which breaks server-side decoding).
 */

export interface UtteranceHandlers {
  onLevel: (level: number, speechProb: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onUtterance: (blob: Blob, durationMs: number, mimeType: string) => void;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

const SILENCE_HANGOVER_MS = 800;
const MIN_UTTERANCE_MS = 500;
const MAX_UTTERANCE_MS = 6000;

export function pickMimeType(): string {
  const found = MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c));
  if (!found) throw new Error("No supported microphone recording format");
  return found;
}

export class Microphone {
  readonly mimeType: string;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recorderChunks: Blob[] = [];
  private utteranceStartedAt = 0;
  private noiseFloor = 0.008;
  private speechProb = 0;
  private speaking = false;
  private lastVoiceAt = 0;
  private paused = false;
  private stopped = false;

  constructor(private readonly handlers: UtteranceHandlers) {
    this.mimeType = pickMimeType();
  }

  static async requestStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule("/vad-worklet.js");
    const source = this.context.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.context, "vad-processor");
    source.connect(this.workletNode);
    // Worklet output is not routed to speakers; analysis only.
    this.workletNode.port.onmessage = (event: MessageEvent<{ rms: number }>) => {
      this.onRms(event.data.rms);
    };
  }

  private onRms(rms: number): void {
    if (this.stopped || this.paused) return;
    const now = performance.now();

    // Track the noise floor slowly while nothing voice-like is happening.
    if (!this.speaking) {
      this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
    }
    const threshold = Math.max(this.noiseFloor * 3, 0.012);
    const voiced = rms > threshold;

    // Smooth speech probability for the visuals.
    this.speechProb = this.speechProb * 0.85 + (voiced ? 1 : 0) * 0.15;
    const level = Math.min(1, rms * 14);
    this.handlers.onLevel(level, this.speechProb);

    if (voiced) this.lastVoiceAt = now;

    if (!this.speaking && voiced && this.speechProb > 0.4) {
      this.speaking = true;
      this.handlers.onSpeechStart();
      this.beginUtterance();
    } else if (this.speaking) {
      const silentFor = now - this.lastVoiceAt;
      const utteranceAge = now - this.utteranceStartedAt;
      if (silentFor > SILENCE_HANGOVER_MS || utteranceAge > MAX_UTTERANCE_MS) {
        this.speaking = false;
        this.handlers.onSpeechEnd();
        this.finishUtterance();
      }
    }
  }

  private beginUtterance(): void {
    if (!this.stream || this.recorder) return;
    this.recorderChunks = [];
    this.utteranceStartedAt = performance.now();
    try {
      this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    } catch {
      return;
    }
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recorderChunks.push(event.data);
    };
    this.recorder.onstop = () => {
      const durationMs = Math.round(performance.now() - this.utteranceStartedAt);
      const chunks = this.recorderChunks;
      this.recorderChunks = [];
      this.recorder = null;
      if (this.stopped || this.paused) return;
      if (durationMs < MIN_UTTERANCE_MS || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: this.mimeType });
      this.handlers.onUtterance(blob, durationMs, this.mimeType);
    };
    this.recorder.start();
  }

  private finishUtterance(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
  }

  pause(): void {
    this.paused = true;
    this.speaking = false;
    this.speechProb = 0;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.handlers.onLevel(0, 0);
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    void this.context?.resume();
  }

  /** Stop everything and release the microphone. */
  stop(): void {
    this.stopped = true;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.workletNode?.disconnect();
    this.workletNode = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }
}
