// Accessibility: every input and textarea on the brand profile form has an accessible name
// (a <label for> that points at its id, or an aria-label). Rendered to HTML with
// react-dom/server; no DOM library is installed and vitest runs in the node environment.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileForm } from "@/components/profile-form";
import { emptyDraft } from "@/lib/brand/schema";

/** Counts the real form controls (type=hidden skipped) and lists the ones with no name. */
function audit(html: string): { total: number; unnamed: string[] } {
  const labelText = new Map<string, string>();
  for (const m of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)) {
    labelText.set(m[1], m[2].replace(/<[^>]+>/g, "").trim());
  }
  let total = 0;
  const unnamed: string[] = [];
  for (const m of html.matchAll(/<(input|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    if (/\btype="hidden"/.test(tag)) continue;
    total += 1;
    const ariaLabel = /\baria-label="([^"]*)"/.exec(tag)?.[1]?.trim();
    if (ariaLabel) continue;
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    if (id && labelText.get(id)) continue;
    unnamed.push(tag);
  }
  return { total, unnamed };
}

describe("ProfileForm accessible names", () => {
  it("every input and textarea has an accessible name", () => {
    const html = renderToString(
      createElement(ProfileForm, {
        brandId: "00000000-0000-0000-0000-000000000000",
        initial: {
          ...emptyDraft(),
          business_name: "Sri Ram Sweets",
          city: "Indore",
          products: [
            { name: "Kaju katli", price: "600", unit: "per kg", note: "gift box" },
            { name: "", price: "", unit: "", note: "" },
          ],
        },
        initialLogoPath: null,
        submitLabel: "Save",
        onSave: async () => ({ ok: true as const }),
      }),
    );

    const { total, unnamed } = audit(html);
    // Sanity: the audit actually saw the controls (3 basics, audience, 2 product rows x 4,
    // whatsapp, notes, colour picker, logo file input).
    expect(total).toBeGreaterThanOrEqual(16);
    expect(unnamed).toEqual([]);
  });

  it("the audit flags a control with no name (guards against a vacuous check)", () => {
    const html = '<label for="a">A</label><input id="a"/><input id="b"/><textarea></textarea>';
    expect(audit(html).unnamed).toEqual(['<input id="b"/>', "<textarea>"]);
  });
});
