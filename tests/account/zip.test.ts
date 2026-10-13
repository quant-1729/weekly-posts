import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import { randomBytes } from "node:crypto";
import { zipChunks, zipStream, ZipError, type ZipEntry } from "@/lib/account/zip";
import { collect, parseZip } from "./zip-read";

const enc = (s: string) => new TextEncoder().encode(s);

describe("zip writer", () => {
  it("zlib.crc32 matches the standard check value", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });

  it("writes a valid empty archive", async () => {
    const bytes = await collect(zipStream([]));
    expect(bytes.length).toBe(22);
    expect(parseZip(bytes).names).toEqual([]);
  });

  it("round-trips entries: empty file, UTF-8 name, binary data, nested folders", async () => {
    const big = randomBytes(1_200_000);
    const entries: ZipEntry[] = [
      { name: "README.txt", data: enc("hello\n") },
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "नमस्ते/कैफ़े.txt", data: enc("हिंदी") },
      { name: "photos/past-posts/a.jpg", data: big },
      { name: "lazy.json", data: async () => enc('{"a":1}') },
    ];
    const parsed = parseZip(await collect(zipStream(entries, new Date("2026-10-13T09:30:00Z"))));
    expect(parsed.names).toEqual(entries.map((e) => e.name));
    expect(Buffer.from(parsed.files.get("photos/past-posts/a.jpg")!).equals(big)).toBe(true);
    expect(new TextDecoder().decode(parsed.files.get("नमस्ते/कैफ़े.txt"))).toBe("हिंदी");
    expect(parsed.files.get("empty.txt")!.length).toBe(0);
    expect(new TextDecoder().decode(parsed.files.get("lazy.json"))).toBe('{"a":1}');
  });

  it("stores the modified time in DOS format", async () => {
    const bytes = await collect(zipStream([{ name: "a.txt", data: enc("x"), modified: new Date("2026-10-13T09:30:44Z") }]));
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect(v.getUint16(10, true)).toBe((9 << 11) | (30 << 5) | 22);
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 13);
  });

  it("reads each file only when it is reached, one at a time", async () => {
    const log: string[] = [];
    const lazy = (name: string): ZipEntry => ({
      name,
      data: async () => {
        log.push(`load ${name}`);
        return enc(name);
      },
    });
    const gen = zipChunks([lazy("a"), lazy("b"), lazy("c")]);
    expect(log).toEqual([]);
    await gen.next(); // header of a
    expect(log).toEqual(["load a"]);
    await gen.next(); // data of a
    await gen.next(); // header of b
    expect(log).toEqual(["load a", "load b"]);
    for await (const chunk of gen) void chunk;
    expect(log).toEqual(["load a", "load b", "load c"]);
  });

  it("works from an async iterable, so entries can be produced as the stream is read", async () => {
    async function* make() {
      yield { name: "one.txt", data: enc("1") };
      yield { name: "two.txt", data: enc("2") };
    }
    expect(parseZip(await collect(zipStream(make()))).names).toEqual(["one.txt", "two.txt"]);
  });

  it.each(["", "/abs.txt", "../x.txt", "a/../x.txt", "a//b.txt", "a\\b.txt", "./x.txt", "a\u0000b"])(
    "rejects the name %j",
    async (name) => {
      await expect(collect(zipStream([{ name, data: enc("x") }]))).rejects.toThrow(ZipError);
    },
  );

  it("rejects a duplicate name", async () => {
    await expect(collect(zipStream([{ name: "a", data: enc("1") }, { name: "a", data: enc("2") }]))).rejects.toThrow(/Duplicate/);
  });

  it("detects a corrupted byte (the reader checks every CRC)", async () => {
    const bytes = Buffer.from(await collect(zipStream([{ name: "a.txt", data: enc("hello world") }])));
    parseZip(bytes);
    bytes[30 + "a.txt".length + 2] ^= 0xff;
    expect(() => parseZip(bytes)).toThrow(/CRC/);
  });
});
