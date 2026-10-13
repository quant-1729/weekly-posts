// H-13: the email lint's unit check runs only inside style="..." attributes, never on href/src tokens.
import { describe, expect, it } from "vitest";
import { lintEmailHtml } from "./lint";

const doc = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>` +
  `<div style="display:none;max-height:0;overflow:hidden">pre</div>${body}</body></html>`;

const unsafeUnits = (html: string) => lintEmailHtml(html).filter((p) => p.includes("rem|vw|vh"));

describe("email lint: unit check (H-13)", () => {
  it("does not flag a random token containing 3rem inside an href or src", () => {
    const html = doc(
      '<a href="https://example.com/e/abc-3rem-def.sig9vw-xyz" style="color:#c2185b">Approve</a>' +
        '<img src="https://example.com/i/token-4vh-end.png" width="100" height="100" alt="x" style="display:block">',
    );
    expect(unsafeUnits(html)).toEqual([]);
  });

  it("still flags a real width:3rem inside a style attribute", () => {
    const html = doc('<p style="width:3rem;color:#111111;font-family:Arial">Hi</p>');
    expect(unsafeUnits(html)).toHaveLength(1);
  });

  it("flags vw and vh units inside style attributes too", () => {
    expect(unsafeUnits(doc('<td style="width:50vw;color:#111111">x</td>'))).toHaveLength(1);
    expect(unsafeUnits(doc('<td style="height:10vh;color:#111111">x</td>'))).toHaveLength(1);
  });
});
