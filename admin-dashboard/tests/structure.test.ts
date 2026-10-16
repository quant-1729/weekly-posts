import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC);
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");

describe("server-only structure", () => {
  const pages = files.filter((f) => f.endsWith("page.tsx"));
  const PUBLIC = ["app/login/page.tsx", "app/auth/verify/page.tsx"];

  it("has the expected pages", () => {
    expect(pages.map(rel).sort()).toEqual(
      [
        "app/(dash)/activity/page.tsx",
        "app/(dash)/devices/page.tsx",
        "app/(dash)/generations/page.tsx",
        "app/(dash)/page.tsx",
        "app/(dash)/users/[id]/page.tsx",
        "app/(dash)/users/page.tsx",
        ...PUBLIC,
      ].sort(),
    );
  });

  it("every page is dynamic and every dashboard page checks the admin itself", () => {
    for (const f of pages) {
      const src = read(f);
      expect(src, rel(f)).toContain('export const dynamic = "force-dynamic"');
      if (!PUBLIC.includes(rel(f))) expect(src, rel(f)).toContain("await requireAdmin()");
    }
  });

  it("every server action that changes something checks the admin first", () => {
    const actions = read(path.join(SRC, "app", "actions.ts"));
    for (const name of ["signOutAction", "revokeSessionAction"]) {
      const body = actions.slice(actions.indexOf(`function ${name}`));
      expect(body.slice(0, 200), name).toContain("requireAdmin()");
    }
  });

  it("the only client component is the navigation highlight; no browser code reads the database or env", () => {
    const client = files.filter((f) => /^\s*["']use client["']/.test(read(f)));
    expect(client.map(rel)).toEqual(["components/nav-links.tsx"]);
    for (const f of files) {
      const src = read(f);
      expect(src, rel(f)).not.toContain("NEXT_PUBLIC_");
      if (rel(f) === "components/nav-links.tsx") expect(src).not.toMatch(/from ["']@\/lib\//);
    }
  });
});
