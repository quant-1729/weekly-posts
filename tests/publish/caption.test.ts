import { describe, expect, it } from "vitest";
import { composeCaption } from "@/lib/publish/caption";
import { instagramKind, pickImagePath } from "@/lib/publish/media";

describe("composeCaption", () => {
  it("puts hashtags on their own paragraph, adds the # and drops duplicates", () => {
    expect(composeCaption("Fresh bread", ["bakery", "#bread", "Bakery", "  "])).toBe("Fresh bread\n\n#bakery #bread");
  });

  it("does not repeat a hashtag already in the caption", () => {
    expect(composeCaption("Love #Bread", ["bread", "cakes"])).toBe("Love #Bread\n\n#cakes");
  });

  it("changes no words and handles empty input", () => {
    expect(composeCaption("  Open until 6pm  ", [])).toBe("Open until 6pm");
    expect(composeCaption(null, ["a"])).toBe("#a");
    expect(composeCaption(undefined, undefined)).toBe("");
  });

  it("fits Instagram's 2200 characters by dropping hashtags first, and 30 tags at most", () => {
    const long = "x".repeat(2195);
    expect(composeCaption(long, ["one", "two"]).length).toBeLessThanOrEqual(2200);
    expect(composeCaption(long, ["one", "two"])).toBe(long);
    const tags = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect((composeCaption("hi", tags).match(/#/g) ?? []).length).toBe(30);
  });
});

describe("which picture goes where", () => {
  it("Instagram feed prefers portrait, then square, then landscape", () => {
    expect(pickImagePath({ square: "s", portrait: "p", vertical: "v" }, "instagram")).toBe("p");
    expect(pickImagePath({ square: "s", vertical: "v" }, "instagram")).toBe("s");
    expect(pickImagePath({ landscape: "l", vertical: "v" }, "instagram")).toBe("l");
    expect(pickImagePath({ vertical: "v" }, "instagram")).toBeNull();
  });

  it("a story uses the vertical picture, and a post with only a vertical picture is a story", () => {
    expect(pickImagePath({ square: "s", vertical: "v" }, "instagram", "story")).toBe("v");
    expect(instagramKind({ vertical: "v" })).toBe("story");
    expect(instagramKind({ square: "s", vertical: "v" })).toBe("feed");
    expect(instagramKind({})).toBe("feed");
  });

  it("a Facebook Page prefers square", () => {
    expect(pickImagePath({ square: "s", portrait: "p" }, "facebook")).toBe("s");
    expect(pickImagePath({ portrait: "p", vertical: "v" }, "facebook")).toBe("p");
    expect(pickImagePath({ vertical: "v" }, "facebook")).toBe("v");
  });
});
