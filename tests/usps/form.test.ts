import { describe, expect, it } from "vitest";
import { detailsFromForm, fieldOfError, formFromDetails, suggestTitle, USP_FIELDS } from "@/lib/usps/form";
import { parseUsp } from "@/lib/usps/schema";
import { USP_KINDS } from "@/lib/usps/types";

describe("USP form conversion", () => {
  it("builds typed details from form text that the server accepts", () => {
    const discount = detailsFromForm("discount", { percent: "20", on: "all cakes", upTo: "true", validTo: "2026-10-20", currency: "GBP" });
    expect(discount).toEqual({ percent: 20, on: "all cakes", upTo: true, validTo: "2026-10-20" });
    expect(parseUsp({ kind: "discount", title: "x", details: discount }).ok).toBe(true);

    const money = detailsFromForm("discount", { amountOff: "5", currency: "gbp", on: "orders" });
    expect(money).toMatchObject({ amountOff: { amount: 5, currency: "GBP" }, upTo: false });

    const price = detailsFromForm("price", { item: "Loaf", price: "4.5", currency: "GBP", unit: "" });
    expect(price).toEqual({ item: "Loaf", price: { amount: 4.5, currency: "GBP" } });
    expect(parseUsp({ kind: "price", title: "x", details: price }).ok).toBe(true);

    const reviews = detailsFromForm("reviews", { rating: "4.8", count: "230", platform: "Google" });
    expect(reviews).toEqual({ rating: 4.8, count: 230, platform: "Google" });
  });

  it("leaves empty fields out, so the server reports them as missing", () => {
    expect(detailsFromForm("quality", { claim: "  ", evidence: "" })).toEqual({});
    const r = parseUsp({ kind: "reviews", title: "x", details: detailsFromForm("reviews", { rating: "", count: "", platform: "" }) });
    expect(r.ok).toBe(false);
    expect(parseUsp({ kind: "price", title: "x", details: detailsFromForm("price", { item: "Loaf", price: "abc", currency: "GBP" }) }).ok).toBe(false);
  });

  it.each(USP_KINDS)("round-trips %s", (kind) => {
    const sample: Record<string, Record<string, unknown>> = {
      discount: { percent: 20, on: "cakes", upTo: false, validFrom: "2026-10-15" },
      price: { item: "Loaf", price: { amount: 4.5, currency: "GBP" }, unit: "loaf" },
      reviews: { rating: 4.8, count: 230, platform: "Google" },
      delivery: { promise: "Same day", area: "Indore" },
      experience: { years: 12 },
    };
    const details = sample[kind] ?? Object.fromEntries(USP_FIELDS[kind].filter((f) => f.type === "text").map((f) => [f.key, "text"]));
    const back = detailsFromForm(kind, formFromDetails(kind, details));
    expect(back).toMatchObject(details);
  });

  it("maps server error paths to form fields", () => {
    expect(fieldOfError("details.price.amount")).toBe("price");
    expect(fieldOfError("details.price.currency")).toBe("currency");
    expect(fieldOfError("details.amountOff.currency")).toBe("currency");
    expect(fieldOfError("details.percent")).toBe("percent");
    expect(fieldOfError("details")).toBe("details");
    expect(fieldOfError("title")).toBe("title");
  });

  it("suggests a short line only from what was entered", () => {
    expect(suggestTitle("discount", { percent: 20, on: "all cakes", upTo: false })).toBe("20% off all cakes");
    expect(suggestTitle("discount", { percent: 20, on: "cakes", upTo: true })).toBe("up to 20% off cakes");
    expect(suggestTitle("price", { item: "Loaf", price: { amount: 4.5, currency: "GBP" }, unit: "loaf" })).toBe("Loaf 4.5 GBP / loaf");
    expect(suggestTitle("reviews", { rating: 4.8, count: 230, platform: "Google" })).toBe("4.8 on Google, 230 reviews");
    expect(suggestTitle("experience", { years: 12 })).toBe("12 years");
    expect(suggestTitle("custom", {})).toBe("");
    expect(suggestTitle("quality", { claim: "x".repeat(100) }).length).toBeLessThanOrEqual(60);
  });
});
