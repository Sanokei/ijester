/**
 * Lightweight level meter for the iris and client-side voice gating.
 * Posts an RMS reading roughly every 32ms. All analysis stays on-device.
 */
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sumSquares = 0;
    this.sampleCount = 0;
    // ~32ms at 48kHz.
    this.windowSize = 1536;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.sumSquares += channel[i] * channel[i];
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
