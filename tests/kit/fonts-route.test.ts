import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/fonts/[file]/route";

const get = (file: string) => GET(new Request("http://localhost/api/fonts/x") as never, { params: Promise.resolve({ file }) } as never);

describe("GET /api/fonts/[file]", () => {
  it("serves a shipped font file with a long cache", async () => {
    const res = await get("NotoSans_700Bold.ttf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/ttf");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  });

  it("serves nothing else: not a missing font, not a licence text, not a path out of the folder", async () => {
    for (const file of ["Nope_700Bold.ttf", "OFL-NotoSans.txt", "../package.json", "..%2Fpackage.json", "a/b.ttf", ".ttf"]) {
      expect((await get(file)).status).toBe(404);
    }
  });
});
