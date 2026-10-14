import { describe, expect, it } from "vitest";
import { findInstagramHandles, normalizeInstagramHandle } from "@/lib/instagram/handle";

describe("normalizeInstagramHandle", () => {
  it.each([
    ["@cornerbakery", "cornerbakery"],
    ["cornerbakery", "cornerbakery"],
    ["  @Corner.Bakery_1  ", "corner.bakery_1"],
    ["https://www.instagram.com/cornerbakery/", "cornerbakery"],
    ["https://www.instagram.com/cornerbakery", "cornerbakery"],
    ["http://instagram.com/cornerbakery/?hl=en&utm_source=ig_web", "cornerbakery"],
    ["instagram.com/cornerbakery", "cornerbakery"],
    ["www.instagram.com/CornerBakery/", "cornerbakery"],
    ["https://m.instagram.com/cornerbakery/#top", "cornerbakery"],
    ["https://www.instagram.com/cornerbakery/reels/", "cornerbakery"],
    ["https://www.instagram.com/_u/cornerbakery", "cornerbakery"],
    ["a", "a"],
    ["a".repeat(30), "a".repeat(30)],
  ])("accepts %j", (input, expected) => {
    expect(normalizeInstagramHandle(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "@",
    "two words",
    "bad/name",
    "name!",
    "a".repeat(31),
    ".leading",
    "trailing.",
    "dou..ble",
    "https://example.com/cornerbakery",
    "https://www.instagram.com/",
    "https://www.instagram.com/p/CxYz123/",
    "https://www.instagram.com/reel/CxYz123/",
    "https://www.instagram.com/explore/tags/bread/",
    "https://www.instagram.com/accounts/login/",
    "https://www.instagram.com/stories/cornerbakery/123/",
    "https://www.instagram.com/cornerbakery/p/CxYz123/",
    "https://www.instagram.com/cornerbakery/reel/CxYz123/",
    "https://www.instagram.com/embed.js",
    "https://evil.example/instagram.com/cornerbakery",
    "https://instagram.com.evil.example/cornerbakery",
    "javascript:alert(1)//instagram.com/x",
    "ftp://instagram.com/cornerbakery",
  ])("rejects %j", (input) => {
    expect(normalizeInstagramHandle(input)).toBeNull();
  });

  it("rejects things that are not text", () => {
    expect(normalizeInstagramHandle(undefined)).toBeNull();
    expect(normalizeInstagramHandle(42)).toBeNull();
    expect(normalizeInstagramHandle({})).toBeNull();
  });
});

describe("findInstagramHandles", () => {
  it("finds a footer link", () => {
    const html = `<footer><a class="social" href="https://www.instagram.com/cornerbakery/" target="_blank"><svg></svg></a></footer>`;
    expect(findInstagramHandles(html)).toEqual(["cornerbakery"]);
  });

  it("finds JSON-LD sameAs entries, including escaped slashes", () => {
    const html = `<script type="application/ld+json">{"@type":"Bakery","sameAs":["https:\\/\\/www.facebook.com\\/cb","https:\\/\\/www.instagram.com\\/corner.bakery\\/"]}</script>`;
    expect(findInstagramHandles(html)).toEqual(["corner.bakery"]);
    const plain = `<script type="application/ld+json">{"sameAs":["https://instagram.com/cornerbakery","https://twitter.com/x"]}</script>`;
    expect(findInstagramHandles(plain)).toEqual(["cornerbakery"]);
  });

  it("ignores post, reel, share and embed links", () => {
    const html = `
      <a href="https://www.instagram.com/p/CxYz123/">post</a>
      <a href="https://www.instagram.com/reel/AbC/">reel</a>
      <a href="https://www.instagram.com/explore/tags/bread/">tag</a>
      <a href="https://www.instagram.com/share/xyz">share</a>
      <a href="https://www.instagram.com/cornerbakery/p/CxYz123/">post under a name</a>
      <script async src="//www.instagram.com/embed.js"></script>
      <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/CxYz123/?utm_source=ig_embed"></blockquote>
      <a href="https://www.instagram.com/accounts/login/">log in</a>`;
    expect(findInstagramHandles(html)).toEqual([]);
  });

  it("returns candidates in page order, once each, without Instagram's own account", () => {
    const html = `
      <a href="https://instagram.com/first.shop?hl=en">1</a>
      <a href="https://www.instagram.com/instagram/">Instagram</a>
      <a href="https://www.instagram.com/second_shop/">2</a>
      <a href="https://www.instagram.com/First.Shop/">again</a>`;
    expect(findInstagramHandles(html)).toEqual(["first.shop", "second_shop"]);
  });

  it("accepts plain text and lists of addresses, and drops trailing punctuation", () => {
    expect(findInstagramHandles("Follow us: https://instagram.com/cornerbakery.")).toEqual(["cornerbakery"]);
    expect(findInstagramHandles(["<html></html>", "https://www.instagram.com/shopone/"])).toEqual(["shopone"]);
    expect(findInstagramHandles("no links here")).toEqual([]);
  });
});
