// Plan a week: the photo card shows the brand's library, an upload action and "No photo", and the pick is sent as photoId.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/plan/actions", () => ({ createPlanAction: vi.fn() }));

import { PlanForm, planPayload } from "@/components/plan/plan-form";
import { emptyWeek } from "@/lib/plans/parse";
import { planInputSchema } from "@/lib/plans/service";

const starts = [{ value: "2026-10-19", label: "Week of Mon 19 Oct" }];
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const html = (photos: { id: string; src: string; description: string }[]) => renderToStaticMarkup(createElement(PlanForm, { brandId: "b1", photos, starts, currency: "INR" }));

describe("Plan a week: photo for the week", () => {
  it("shows the library as selectable tiles with No photo and an upload action", () => {
    const out = html([
      { id: A, src: "/api/files/photos/b1/a.jpg", description: "Cakes" },
      { id: B, src: "/api/files/photos/b1/b.jpg", description: "Shop" },
    ]);
    expect(out).toContain(`data-photo-id="${A}"`);
    expect(out).toContain(`data-photo-id="${B}"`);
    expect(out).toContain('src="/api/files/photos/b1/a.jpg"');
    expect(out).toContain("data-photo-none");
    expect(out).toContain("No photo");
    expect(out).toContain("data-plan-upload");
    expect(out).toContain("Upload a photo");
    // The most recent photo starts selected.
    const tileOf = (id: string) => out.slice(out.indexOf(`data-photo-id="${id}"`)).split("</li>")[0];
    expect(tileOf(A)).toContain('checked=""');
    expect(tileOf(B)).not.toContain('checked=""');
  });

  it("with an empty library shows the upload action prominently and still offers No photo", () => {
    const out = html([]);
    expect(out).toContain("Your photo library is empty.");
    expect(out).toContain("data-plan-upload");
    expect(out).toContain("border-dashed");
    expect(out).toContain("data-photo-none");
  });

  it("sends the chosen photo as photoId (and null for No photo), which the plan accepts", () => {
    const base = { start: "2026-10-19", on: "cakes", days: emptyWeek().map((d, i) => (i === 0 ? { ...d, on: true, value: 10 } : d)), channels: ["instagram"], cta: "whatsapp", time: "09:00" };
    expect(planPayload({ ...base, photoId: A }).photoId).toBe(A);
    expect(planPayload({ ...base, photoId: null }).photoId).toBeNull();
    expect(planInputSchema.safeParse(planPayload({ ...base, photoId: A })).data?.photoId).toBe(A);
  });
});
