/**
 * WAV helpers. Pure functions, no browser or Node APIs, so the browser
 * recorder and the upload route share them and tests can run them directly.
 *
 * Gemini does not accept the browser's default webm recordings, so the
 * recorder captures raw PCM and writes a WAV: 16 kHz, mono, 16-bit.
 */

export const WAV_SAMPLE_RATE = 16_000;
export const WAV_CHANNELS = 1;
export const WAV_BITS = 16;
export const WAV_HEADER_BYTES = 44;
/** Voice notes stop at 2 minutes: a 16 kHz mono WAV then stays under the 4.5 MB Vercel request limit. */
export const MAX_RECORDING_SECONDS = 120;
/** Largest WAV the upload route accepts: 2 minutes of 16 kHz mono 16-bit, plus header and a little slack. */
export const MAX_WAV_BYTES =
  WAV_HEADER_BYTES + (MAX_RECORDING_SECONDS + 5) * WAV_SAMPLE_RATE * (WAV_BITS / 8);

/** Average (box filter) or interpolate mono float samples to `toRate`. */
export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  if (ratio > 1) {
    // Downsampling: average the source samples that fall in each output slot (a cheap low-pass).
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      out[i] = sum / (end - start);
    }
  } else {
    // Upsampling: linear interpolation.
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
  }
  return out;
}

/** Float samples in [-1, 1] to signed 16-bit PCM, clipping anything outside. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** Joins chunks captured one after another into one array. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** A complete WAV file (44-byte header + little-endian PCM) from 16-bit mono samples. */
export function encodeWav(samples: Int16Array, sampleRate: number = WAV_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, WAV_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * WAV_CHANNELS * (WAV_BITS / 8), true); // byte rate
  view.setUint16(32, WAV_CHANNELS * (WAV_BITS / 8), true); // block align
  view.setUint16(34, WAV_BITS, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(WAV_HEADER_BYTES + i * 2, samples[i], true);

  return new Uint8Array(buffer);
}

/** Captured mono float chunks (at the microphone's rate) to a 16 kHz mono 16-bit WAV. */
export function chunksToWav16k(chunks: Float32Array[], inputRate: number): Uint8Array {
  const mono = resampleMono(concatFloat32(chunks), inputRate, WAV_SAMPLE_RATE);
  return encodeWav(floatToPcm16(mono), WAV_SAMPLE_RATE);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  dataBytes: number;
  seconds: number;
}

/**
 * Reads a WAV header. Returns null unless it is plain PCM with a "data" chunk
 * that fits in the file. Used by the upload route to check what the browser sent.
 */
export function readWavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;

  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.sampleRate <= 0 || fmt.channels <= 0 || fmt.bits <= 0) return null;
      if (body + size > bytes.length) return null;
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bits: fmt.bits,
        dataBytes: size,
        seconds: size / bytesPerSecond,
      };
    }
    offset = body + size + (size % 2); // chunks are word aligned
  }
  return null;
}
