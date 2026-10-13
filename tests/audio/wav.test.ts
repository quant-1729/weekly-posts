import { describe, expect, it } from "vitest";
import {
  MAX_RECORDING_SECONDS,
  MAX_WAV_BYTES,
  WAV_HEADER_BYTES,
  WAV_SAMPLE_RATE,
  chunksToWav16k,
  concatFloat32,
  encodeWav,
  floatToPcm16,
  readWavInfo,
  resampleMono,
} from "@/lib/audio/wav";

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

describe("WAV encoder", () => {
  it("writes a valid 16 kHz mono 16-bit PCM header", () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const wav = encodeWav(samples);
    const view = new DataView(wav.buffer);

    expect(wav.length).toBe(WAV_HEADER_BYTES + samples.length * 2);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8); // RIFF chunk size
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    // Little-endian samples follow the header.
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([0, 1000, -1000, 32767, -32768]);
  });

  it("reads back what it wrote", () => {
    const info = readWavInfo(encodeWav(new Int16Array(16000)));
    expect(info).toEqual({ sampleRate: 16000, channels: 1, bits: 16, dataBytes: 32000, seconds: 1 });
  });

  it("an empty recording is still a valid header", () => {
    const wav = encodeWav(new Int16Array(0));
    expect(wav.length).toBe(44);
    expect(readWavInfo(wav)?.seconds).toBe(0);
  });

  it("readWavInfo rejects things that are not plain PCM WAV", () => {
    expect(readWavInfo(new Uint8Array(10))).toBeNull();
    expect(readWavInfo(new TextEncoder().encode("RIFF....WAVEfmt ".padEnd(60, "x")))).toBeNull();
    const wav = encodeWav(new Int16Array(100));
    const notPcm = wav.slice();
    new DataView(notPcm.buffer).setUint16(20, 3, true); // float format
    expect(readWavInfo(notPcm)).toBeNull();
    expect(readWavInfo(wav.subarray(0, 60))).toBeNull(); // data chunk longer than the file
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(0)]);
    expect(readWavInfo(webm)).toBeNull();
  });
});

describe("PCM conversion", () => {
  it("scales and clips floats to 16-bit", () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 16384, 32767, -32768]);
  });

  it("joins chunks in order", () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("resampling to 16 kHz", () => {
  it("keeps the duration when downsampling 48 kHz", () => {
    const out = resampleMono(new Float32Array(48000).fill(0.25), 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.25, 5);
  });

  it("handles 44.1 kHz (non-integer ratio)", () => {
    const out = resampleMono(new Float32Array(44100).fill(0.5), 44100, 16000);
    expect(out.length).toBe(16000);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it("returns the input unchanged when the rate already matches", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleMono(input, 16000, 16000)).toBe(input);
  });

  it("chunksToWav16k from 48 kHz gives one second of 16 kHz mono audio", () => {
    const chunk = new Float32Array(4800).fill(0.1);
    const wav = chunksToWav16k(Array.from({ length: 10 }, () => chunk), 48000);
    const info = readWavInfo(wav)!;
    expect(info.sampleRate).toBe(WAV_SAMPLE_RATE);
    expect(info.channels).toBe(1);
    expect(info.bits).toBe(16);
    expect(info.seconds).toBeCloseTo(1, 2);
  });
});

describe("limits", () => {
  it("allows a full 2-minute recording and stays under the 4.5 MB Vercel body limit", () => {
    const twoMinutes = WAV_HEADER_BYTES + MAX_RECORDING_SECONDS * 32000;
    expect(MAX_RECORDING_SECONDS).toBe(120);
    expect(MAX_WAV_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_WAV_BYTES).toBeGreaterThan(twoMinutes);
  });
});
