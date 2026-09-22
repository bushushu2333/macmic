// PCM16 mono at 16 kHz, emitted in 200 ms packets. Audio never leaves this
// processor except through its owning renderer's session-scoped IPC bridge.
class MacmicPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new ArrayBuffer(3200 * 2);
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'flush' || !this.active) return;
      this.active = false;
      this.emit();
      this.port.postMessage({ type: 'flushed' });
    };
  }
  emit() {
    if (!this.offset) return;
    const buffer = this.offset === 3200 ? this.buffer : this.buffer.slice(0, this.offset * 2);
    this.port.postMessage({ type: 'audio', buffer }, [buffer]);
    this.buffer = new ArrayBuffer(3200 * 2);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }
  process(inputs) {
    // Outputs retain the AudioWorklet's zero-filled buffers (no mic feedback).
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame];
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      this.view.setInt16(this.offset * 2, sample * (sample < 0 ? 32768 : 32767), true);
      if (++this.offset === 3200) this.emit();
    }
    return true;
  }
}
registerProcessor('macmic-pcm-capture', MacmicPcmCapture);
