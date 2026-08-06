/**
 * Local playback of allowlisted, versioned sound assets. The server sends a
 * cue *id*; only files listed in /sounds/manifest.json can ever play.
 */

interface ManifestSound {
  id: string;
  file: string;
  defaultGain: number;
}

interface Manifest {
  version: string;
  sounds: ManifestSound[];
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private manifest: Manifest | null = null;
  private muted = false;
  private volume = 0.7;
  private playing = false;

  /** Must be called from a user gesture so the AudioContext can start. */
  async init(): Promise<void> {
    if (this.context) {
      await this.context.resume().catch(() => {});
      return;
    }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);

    const response = await fetch("/sounds/manifest.json");
    if (!response.ok) throw new Error("sound manifest missing");
    this.manifest = (await response.json()) as Manifest;

    await Promise.all(
      this.manifest.sounds.map(async (sound) => {
        try {
          const file = await fetch(sound.file);
          if (!file.ok) return;
          const decoded = await this.context!.decodeAudioData(await file.arrayBuffer());
          this.buffers.set(sound.id, decoded);
        } catch {
          // A missing asset silently disables that cue locally.
        }
      }),
    );
  }

  get manifestVersion(): string {
    return this.manifest?.version ?? "unknown";
  }

  /**
   * Play an allowlisted cue. Returns callbacks-driven timing via the two
   * handlers; ignored entirely while muted or while another cue plays (v1
   * disallows simultaneous cues).
   */
  play(
    cueId: string,
    gain: number,
    delayMs: number,
    onStart?: () => void,
    onEnd?: () => void,
  ): boolean {
    if (!this.context || !this.master || this.muted || this.playing) return false;
    const buffer = this.buffers.get(cueId);
    if (!buffer) return false;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const cueGain = this.context.createGain();
    cueGain.gain.value = Math.min(0.9, Math.max(0, gain));
    source.connect(cueGain);
    cueGain.connect(this.master);

    const startAt = this.context.currentTime + Math.min(1.2, Math.max(0, delayMs / 1000));
    this.playing = true;

    const startTimer = window.setTimeout(() => onStart?.(), delayMs);
    source.onended = () => {
      this.playing = false;
      onEnd?.();
    };
    source.addEventListener("ended", () => window.clearTimeout(startTimer), { once: true });
    source.start(startAt);
    return true;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Mute is instant and global: also duck anything mid-flight.
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  async destroy(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}
