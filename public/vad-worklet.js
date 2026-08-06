/**
 * Streaming audio tap: posts an RMS reading (~every 32ms) for the iris and
 * VAD, and a continuous stream of 16 kHz mono Int16 PCM (128ms packets) for
 * transcription. All analysis stays on-device; the main thread decides what
 * is actually sent to the server.
 */
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Level meter (~32ms at 48kHz).
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.windowSize = 1536;
    // Fractional decimator from the context rate down to 16kHz.
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.phase = 0;
    this.acc = 0;
    this.accCount = 0;
    // 2048 samples = 128ms at 16kHz.
    this.out = new Int16Array(2048);
    this.outIndex = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        this.sumSquares += sample * sample;

        // Average every `ratio` input samples into one output sample.
        this.acc += sample;
        this.accCount += 1;
        this.phase += 1;
        if (this.phase >= this.ratio) {
          this.phase -= this.ratio;
          const mean = this.acc / this.accCount;
          this.acc = 0;
          this.accCount = 0;
          const clamped = Math.max(-1, Math.min(1, mean));
          this.out[this.outIndex++] = Math.round(clamped * 32767);
          if (this.outIndex === this.out.length) {
            const packet = this.out;
            this.out = new Int16Array(2048);
            this.outIndex = 0;
            this.port.postMessage({ pcm: packet }, [packet.buffer]);
          }
        }
      }
      this.sampleCount += channel.length;
      if (this.sampleCount >= this.windowSize) {
        const rms = Math.sqrt(this.sumSquares / this.sampleCount);
        this.port.postMessage({ rms });
        this.sumSquares = 0;
        this.sampleCount = 0;
      }
    }
    return true;
  }
}

registerProcessor("vad-processor", VadProcessor);
