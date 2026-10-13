import { crc32 } from "node:zlib";

/**
 * A minimal streaming ZIP writer: the "store" method (no compression), UTF-8 names,
 * `zlib.crc32` (Node 22+), no package. Each entry is produced, written and released one at
 * a time, so a large account never sits in memory all at once (only one file at a time).
 *
 * No ZIP64: an archive over 4 GB, a file over 4 GB or more than 65,535 entries throws
 * instead of writing a broken file. Photos are limited to a few MB each, so this is far away.
 */

export interface ZipEntry {
  /** Path inside the ZIP, forward slashes, no leading slash, no "..". */
  name: string;
  /** The bytes, or a function that gets them when the entry is reached (so files load one by one). */
  data: Uint8Array | (() => Promise<Uint8Array>);
  /** Modified time; defaults to the time the archive started. */
  modified?: Date;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: needed for "store" with UTF-8 names

function checkName(name: string): Uint8Array {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /[\x00-\x1f]/.test(name) ||
    name.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    throw new ZipError(`Invalid entry name: ${JSON.stringify(name)}`);
  }
  const bytes = new TextEncoder().encode(name);
  if (bytes.length > 0xffff) throw new ZipError("Entry name too long");
  return bytes;
}

/** DOS date and time fields (UTC). The format cannot show years before 1980. */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

function localHeader(r: CentralRecord): Uint8Array {
  const buf = new Uint8Array(30 + r.name.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, UTF8_FLAG, true);
  v.setUint16(8, 0, true); // method 0 = store
  v.setUint16(10, r.time, true);
  v.setUint16(12, r.date, true);
  v.setUint32(14, r.crc, true);
  v.setUint32(18, r.size, true); // compressed size = size, nothing is compressed
  v.setUint32(22, r.size, true);
  v.setUint16(26, r.name.length, true);
  v.setUint16(28, 0, true); // no extra field
  buf.set(r.name, 30);
  return buf;
}

function centralHeader(r: CentralRecord): Uint8Array {
  const buf = new Uint8Array(46 + r.name.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, VERSION, true); // version made by
  v.setUint16(6, VERSION, true); // version needed
  v.setUint16(8, UTF8_FLAG, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, r.time, true);
  v.setUint16(14, r.date, true);
  v.setUint32(16, r.crc, true);
  v.setUint32(20, r.size, true);
  v.setUint32(24, r.size, true);
  v.setUint16(28, r.name.length, true);
  // 30 extra length, 32 comment length, 34 disk number, 36 internal attrs, 38 external attrs: all 0
  v.setUint32(42, r.offset, true);
  buf.set(r.name, 46);
  return buf;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const buf = new Uint8Array(22);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  return buf;
}

/** Yields the ZIP bytes in chunks: for each entry a header then its data, then the central directory. */
export async function* zipChunks(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  now: Date = new Date(),
): AsyncGenerator<Uint8Array> {
  const central: CentralRecord[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for await (const entry of entries) {
    const name = checkName(entry.name);
    if (seen.has(entry.name)) throw new ZipError(`Duplicate entry name: ${entry.name}`);
    seen.add(entry.name);
    if (central.length >= MAX_ENTRIES) throw new ZipError("Too many entries for a ZIP without ZIP64");

    const data = typeof entry.data === "function" ? await entry.data() : entry.data;
    if (data.length > MAX_32) throw new ZipError("Entry too large for a ZIP without ZIP64");
    const { date, time } = dosDateTime(entry.modified ?? now);
    const record: CentralRecord = { name, crc: crc32(data), size: data.length, offset, date, time };

    const header = localHeader(record);
    offset += header.length + data.length;
    if (offset > MAX_32) throw new ZipError("Archive too large for a ZIP without ZIP64");
    central.push(record);

    yield header;
    if (data.length > 0) yield data;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const r of central) {
    const h = centralHeader(r);
    cdSize += h.length;
    yield h;
  }
  yield endRecord(central.length, cdSize, cdOffset);
}

/** The same bytes as a web ReadableStream, pulled one chunk at a time (back-pressure aware). */
export function zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  now?: Date,
): ReadableStream<Uint8Array> {
  const gen = zipChunks(entries, now);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await gen.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
}
