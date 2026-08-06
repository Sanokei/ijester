/**
 * Microphone capture: continuous rolling windows with a level meter.
 *
 * Speech is freeform conversation, not turn-taking with a robot — so the
 * recorder runs continuously in back-to-back ~3 s windows rather than
 * waiting for utterance boundaries. A fresh MediaRecorder per window keeps
 * every emitted blob a complete standalone container (chunked MediaRecorder
 * output after the first slice lacks headers, which breaks server-side
 * decoding). Voice activity detection only decides whether a finished
 * window is worth sending; it never gates capture itself.
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

/** Length of each rolling capture window. */
const WINDOW_MS = 2800;
/** Fraction of voiced frames a window needs before it is sent at all. */
const MIN_SPEECH_RATIO = 0.05;

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
  private windowStartedAt = 0;
  private windowTimer: number | undefined;
  private voicedFrames = 0;
  private totalFrames = 0;
  private noiseFloor = 0.008;
  private speechProb = 0;
  private speaking = false;
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
    this.beginWindow();
  }

  private onRms(rms: number): void {
    if (this.stopped || this.paused) return;

    // Track the noise floor slowly while nothing voice-like is happening.
    if (!this.speaking) {
      this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
    }
    const threshold = Math.max(this.noiseFloor * 3, 0.012);
    const voiced = rms > threshold;

    this.totalFrames += 1;
    if (voiced) this.voicedFrames += 1;

    // Smooth speech probability for the visuals.
    this.speechProb = this.speechProb * 0.85 + (voiced ? 1 : 0) * 0.15;
    const level = Math.min(1, rms * 14);
    this.handlers.onLevel(level, this.speechProb);

    if (!this.speaking && this.speechProb > 0.4) {
      this.speaking = true;
      this.handlers.onSpeechStart();
    } else if (this.speaking && this.speechProb < 0.12) {
      this.speaking = false;
      this.handlers.onSpeechEnd();
    }
  }

  /** Start the next rolling capture window. */
  private beginWindow(): void {
    if (!this.stream || this.stopped || this.paused || this.recorder) return;
    this.voicedFrames = 0;
    this.totalFrames = 0;
    this.windowStartedAt = performance.now();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    } catch {
      return;
    }
    this.recorder = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Math.round(performance.now() - this.windowStartedAt);
      const speechRatio = this.totalFrames > 0 ? this.voicedFrames / this.totalFrames : 0;
      if (this.recorder === recorder) this.recorder = null;
      if (!this.stopped) {
        // Send only windows that contained some speech; silence stays local.
        if (!this.paused && chunks.length > 0 && durationMs > 400 && speechRatio >= MIN_SPEECH_RATIO) {
          this.handlers.onUtterance(new Blob(chunks, { type: this.mimeType }), durationMs, this.mimeType);
        }
        this.beginWindow(); // roll straight into the next window
      }
    };
    recorder.start();
    this.windowTimer = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, WINDOW_MS);
  }

  pause(): void {
    this.paused = true;
    this.speaking = false;
    this.speechProb = 0;
    window.clearTimeout(this.windowTimer);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.handlers.onLevel(0, 0);
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    void this.context?.resume();
    this.beginWindow();
  }

  /** Stop everything and release the microphone. */
  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.windowTimer);
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
