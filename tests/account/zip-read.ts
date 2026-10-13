import { crc32 } from "node:zlib";

/**
 * A strict ZIP reader for tests: parses the end record and the central directory (it does not trust
 * the local headers alone), then checks every entry's local header, size, contiguity and CRC.
 */

export interface ParsedZip {
  names: string[];
  files: Map<string, Uint8Array>;
}

export function parseZip(buf: Uint8Array): ParsedZip {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 22) throw new Error("too short for a ZIP");
  const eocd = buf.length - 22;
  if (v.getUint32(eocd, true) !== 0x06054b50) throw new Error("no end-of-central-directory record");
  if (v.getUint16(eocd + 20, true) !== 0) throw new Error("unexpected archive comment");
  const count = v.getUint16(eocd + 10, true);
  if (v.getUint16(eocd + 8, true) !== count) throw new Error("entry counts differ");
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (cdOffset + cdSize !== eocd) throw new Error("central directory does not end where the end record starts");

  const names: string[] = [];
  const files = new Map<string, Uint8Array>();
  let cursor = cdOffset;
  let expectedLocal = 0;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(cursor, true) !== 0x02014b50) throw new Error(`bad central header #${i}`);
    const flags = v.getUint16(cursor + 8, true);
    const method = v.getUint16(cursor + 10, true);
    const crc = v.getUint32(cursor + 16, true);
    const csize = v.getUint32(cursor + 20, true);
    const usize = v.getUint32(cursor + 24, true);
    const nameLen = v.getUint16(cursor + 28, true);
    const extraLen = v.getUint16(cursor + 30, true);
    const commentLen = v.getUint16(cursor + 32, true);
    const local = v.getUint32(cursor + 42, true);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(cursor + 46, cursor + 46 + nameLen));
    if (method !== 0) throw new Error(`${name}: not stored`);
    if ((flags & 0x0800) === 0) throw new Error(`${name}: UTF-8 flag missing`);
    if (csize !== usize) throw new Error(`${name}: sizes differ for a stored entry`);

    // The local header must agree with the central one.
    if (local !== expectedLocal) throw new Error(`${name}: local header not where expected`);
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`${name}: bad local header`);
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const lName = new TextDecoder().decode(buf.subarray(local + 30, local + 30 + lNameLen));
    if (lName !== name) throw new Error(`${name}: local name is ${lName}`);
    if (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== csize || v.getUint32(local + 22, true) !== usize) {
      throw new Error(`${name}: local header disagrees with the central directory`);
    }
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + usize);
    if (data.length !== usize) throw new Error(`${name}: data runs past the end`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    expectedLocal = start + usize;

    if (files.has(name)) throw new Error(`${name}: duplicate entry`);
    names.push(name);
    files.set(name, data);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== eocd) throw new Error("central directory size does not match its entries");
  if (expectedLocal !== cdOffset) throw new Error("gap between the last file and the central directory");
  return { names, files };
}

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
