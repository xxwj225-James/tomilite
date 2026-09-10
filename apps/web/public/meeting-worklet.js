/**
 * Meeting capture worklet.
 *
 * Lives in public/ rather than being built from a Blob URL: index.html's CSP is
 * `script-src 'self' 'unsafe-eval'` with no `blob:`, so an inlined worklet would
 * be blocked outright.
 *
 * Job: collect the mixed signal into ~256ms blocks and hand them to the main
 * thread, resampled to the 16kHz mono that whisper.cpp requires.
 *
 * In practice the AudioContext is created with sampleRate 16000 and Chromium
 * does the resampling for us, so `ratio` is 1 and this is a pure accumulator —
 * no decoder, no ffmpeg. The fractional path below is a safety net for the case
 * where a platform ignores the requested rate (linear interpolation is plenty
 * for speech).
 */
class MeetingCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var opts = (options && options.processorOptions) || {};
    var sourceRate = opts.sampleRate || sampleRate;
    this.ratio = sourceRate / 16000;
    this.passthrough = Math.abs(this.ratio - 1) < 1e-6;

    this.blockSize = 4096; // ~256ms at 16kHz
    this.acc = new Float32Array(this.blockSize);
    this.n = 0;

    // Fractional resampler state, carried across process() calls.
    this.prev = 0;
    this.pos = 0;

    this.port.onmessage = (e) => {
      if (e.data === 'flush') this.flush();
    };
  }

  flush() {
    if (this.n === 0) return;
    var out = this.acc.slice(0, this.n);
    // Transferred, not copied — this fires ~4×/second for the life of a meeting.
    this.port.postMessage(out, [out.buffer]);
    this.acc = new Float32Array(this.blockSize);
    this.n = 0;
  }

  push(v) {
    if (this.n >= this.blockSize) this.flush();
    this.acc[this.n++] = v;
  }

  process(inputs) {
    var input = inputs[0];
    if (!input || input.length === 0) return true;
    var ch = input[0];
    if (!ch || ch.length === 0) return true;

    if (this.passthrough) {
      for (var i = 0; i < ch.length; i++) this.push(ch[i]);
    } else {
      for (var j = 0; j < ch.length; j++) {
        var cur = ch[j];
        this.pos += 1 / this.ratio;
        while (this.pos >= 1) {
          this.pos -= 1;
          this.push(this.prev + (cur - this.prev) * this.pos);
        }
        this.prev = cur;
      }
    }
    return true;
  }
}

registerProcessor('meeting-capture', MeetingCaptureProcessor);
