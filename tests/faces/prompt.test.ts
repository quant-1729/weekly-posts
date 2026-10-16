import { describe, expect, it } from "vitest";
import { POST_COPY_SYSTEM, buildPostCopyUser } from "@/lib/ai/prompts/v3";

const base = {
  brandName: "Corner Clinic",
  sells: "physiotherapy",
  country: "India",
  voice: "",
  wordsToAvoid: [],
  regulated: "health" as const,
  language: "en",
  postType: "brand",
  primary: null,
  secondary: [],
  offerLine: null,
  dates: { startsOn: null, endsOn: null },
  ctaKind: "call",
  contactLines: [],
  channels: ["instagram"],
  ownerDescription: "Open on Sundays now",
};

describe("copy prompt: Brand Face (F-3)", () => {
  it("Tween keeps its playful persona; other faces are presenters", () => {
    expect(buildPostCopyUser({ ...base, mascot: { name: "Tween" } })).toContain("MASCOT: Tween, friendly, curious and a little playful.");
    expect(buildPostCopyUser({ ...base, mascot: { name: "Asha", kind: "illustrated" } })).toContain("MASCOT: Asha, a drawn character who presents the brand");
    expect(buildPostCopyUser({ ...base, mascot: { name: "Priya", kind: "owner_photo" } })).toContain("the business owner, speaking for their own business");
    expect(buildPostCopyUser({ ...base, mascot: { name: "Sam", kind: "photoreal" } })).toContain("MASCOT: Sam, a presenter for the brand");
    expect(buildPostCopyUser({ ...base, mascot: null })).toContain('MASCOT: none (bubble "" and pose "").');
  });

  it("the system rules forbid advice, promises and posing as a customer or professional", () => {
    expect(POST_COPY_SYSTEM).toContain("never gives medical, financial or legal advice");
    expect(POST_COPY_SYSTEM).toContain("never claims to be a customer, reviewer or professional");
  });
});

describe("copy prompt: extra post types", () => {
  it("names the extras after the main type, and says nothing when there are none", () => {
    const withExtras = buildPostCopyUser({ ...base, postType: "new_product", extraPostTypes: ["offer", "event"], mascot: null });
    expect(withExtras).toContain("post type: new_product (also: offer, event)");
    expect(buildPostCopyUser({ ...base, mascot: null })).not.toContain("also:");
    expect(buildPostCopyUser({ ...base, extraPostTypes: [], mascot: null })).not.toContain("also:");
  });
});
