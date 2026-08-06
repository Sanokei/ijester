/**
 * Microphone capture: a continuous 16 kHz PCM stream with a level meter.
 *
 * Speech is freeform conversation, not turn-taking with a robot — audio
 * streams to the server as it is captured (256ms packets) and the server
 * decides window boundaries. Voice activity detection gates only whether
 * packets are worth sending (with a generous hangover so trailing words
 * are never clipped); it never chops the capture itself.
 */

export const PCM_MIME = "audio/pcm;rate=16000";

export interface MicrophoneHandlers {
  onLevel: (level: number, speechProb: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** A ~256ms PCM packet ready to stream. `speech` is the VAD verdict. */
  onAudioPacket: (pcm: ArrayBuffer, durationMs: number, speech: boolean) => void;
}

/** Keep streaming this long after speech stops so pauses reach the server. */
const HANGOVER_MS = 1600;
/** Int16 samples per outbound packet (256ms at 16kHz). */
const PACKET_SAMPLES = 4096;
const SAMPLE_RATE = 16_000;

export class Microphone {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private packet = new Int16Array(PACKET_SAMPLES);
  private packetIndex = 0;
  private noiseFloor = 0.008;
  private speechProb = 0;
  private speaking = false;
  private lastVoiceAt = 0;
  private paused = false;
  private stopped = false;

  constructor(private readonly handlers: MicrophoneHandlers) {}

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
    this.workletNode.port.onmessage = (
      event: MessageEvent<{ rms?: number; pcm?: Int16Array }>,
    ) => {
      if (event.data.rms !== undefined) this.onRms(event.data.rms);
      if (event.data.pcm) this.onPcm(event.data.pcm);
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
    if (voiced) this.lastVoiceAt = now;

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

  private onPcm(samples: Int16Array): void {
    if (this.stopped || this.paused) return;

    // Stream while someone is (or was very recently) speaking; long dead
    // air stays local and costs nothing.
    const withinHangover = performance.now() - this.lastVoiceAt < HANGOVER_MS;
    if (!this.speaking && !withinHangover) {
      this.packetIndex = 0; // discard buffered silence
      return;
    }

    let offset = 0;
    while (offset < samples.length) {
      const space = PACKET_SAMPLES - this.packetIndex;
      const take = Math.min(space, samples.length - offset);
      this.packet.set(samples.subarray(offset, offset + take), this.packetIndex);
      this.packetIndex += take;
      offset += take;
      if (this.packetIndex === PACKET_SAMPLES) {
        const out = this.packet;
        this.packet = new Int16Array(PACKET_SAMPLES);
        this.packetIndex = 0;
        this.handlers.onAudioPacket(
          out.buffer,
          Math.round((PACKET_SAMPLES / SAMPLE_RATE) * 1000),
          this.speaking,
        );
      }
    }
  }

  pause(): void {
    this.paused = true;
    this.speaking = false;
    this.speechProb = 0;
    this.packetIndex = 0;
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
    this.workletNode?.disconnect();
    this.workletNode = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }
}
