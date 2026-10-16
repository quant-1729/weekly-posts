import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShareButtons } from "@/components/share/share-buttons";
import { s } from "@/lib/i18n/strings";
import { bindShareDom, createShareKit, type ShareEnv } from "@/lib/share/core";
import { SHARE_FORMATS, STORY_FORMAT, defaultShareFormat, isShareFormat, shareFilename } from "@/lib/share/formats";
import { sharePageScript, sharePageText } from "@/lib/share/page-script";

// ---------------------------------------------------------------------------------------------
// A phone and a desktop, as mocks. (The real share sheet is checked by hand: docs/email-checklist.md.)
// ---------------------------------------------------------------------------------------------

function phone(o: { share?: (d: unknown) => Promise<void>; canShare?: (d: { files?: File[] }) => boolean; clipboard?: boolean; blobType?: string; fetchOk?: boolean; ua?: string } = {}) {
  const calls: string[] = [];
  const shareArgs: Array<{ files?: File[]; text?: string }> = [];
  const nav = {
    userAgent: o.ua ?? "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile",
    canShare: o.canShare ?? ((d: { files?: File[] }) => Array.isArray(d.files) && d.files.length > 0),
    share: vi.fn(async (d: { files?: File[]; text?: string }) => {
      calls.push("share");
      shareArgs.push(d);
      if (o.share) await o.share(d);
    }),
    clipboard:
      o.clipboard === false
        ? undefined
        : {
            writeText: vi.fn(async (t: string) => {
              calls.push(`copy:${t}`);
            }),
          },
  };
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(`fetch:${url}`);
    return { ok: o.fetchOk !== false, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: o.blobType ?? "image/png" }) };
  });
  const env: ShareEnv = { navigator: nav, fetch: fetchMock, File: File as unknown as ShareEnv["File"] };
  return { env, nav, calls, shareArgs, fetchMock };
}

describe("formats per channel (Req 17)", () => {
  it("square for Instagram and Facebook, landscape for LinkedIn and Google Business Profile", () => {
    expect(defaultShareFormat("instagram")).toBe("square");
    expect(defaultShareFormat("facebook")).toBe("square");
    expect(defaultShareFormat("linkedin")).toBe("landscape");
    expect(defaultShareFormat("gbp")).toBe("landscape");
  });
  it("story or status uses the vertical picture", () => {
    expect(STORY_FORMAT).toBe("vertical");
    expect(SHARE_FORMATS).toEqual(["square", "vertical", "landscape"]);
    expect(isShareFormat("vertical")).toBe(true);
    expect(isShareFormat("tall")).toBe(false);
  });
  it("gives short, safe file names", () => {
    expect(shareFilename("instagram", "square")).toBe("instagram-square.png");
    expect(shareFilename("gbp", "landscape")).toBe("gbp-landscape.png");
    expect(shareFilename("linkedin", "vertical", "jpg")).toBe("linkedin-vertical.jpg");
    expect(shareFilename("../x y", "square")).toBe("xy-square.png");
  });
});

describe("feature detection", () => {
  it("can share files when navigator.canShare says yes for a file", () => {
    expect(createShareKit(phone().env).canShareFiles()).toBe(true);
  });
  it("cannot when canShare is missing, share is missing, or canShare says no", () => {
    const a = phone();
    delete (a.nav as { canShare?: unknown }).canShare;
    expect(createShareKit(a.env).canShareFiles()).toBe(false);
    const b = phone();
    delete (b.nav as { share?: unknown }).share;
    expect(createShareKit(b.env).canShareFiles()).toBe(false);
    expect(createShareKit(phone({ canShare: () => false }).env).canShareFiles()).toBe(false);
    expect(createShareKit(phone({ canShare: () => { throw new Error("nope"); } }).env).canShareFiles()).toBe(false);
  });
  it("H-11: probes with a real 1x1 PNG file", () => {
    const probes: File[] = [];
    const p = phone({ canShare: (d) => (probes.push(...(d.files ?? [])), true) });
    expect(createShareKit(p.env).canShareFiles()).toBe(true);
    expect(probes).toHaveLength(1);
    expect(probes[0].name).toBe("probe.png");
    expect(probes[0].type).toBe("image/png");
    expect(probes[0].size).toBeGreaterThan(8);
  });
  it("only the hint looks at the user agent", () => {
    expect(createShareKit(phone({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari" }).env).isIos()).toBe(true);
    expect(createShareKit(phone().env).isIos()).toBe(false);
  });
});

describe("making the File", () => {
  it("fetches the picture and builds a File with the right name and type", async () => {
    const p = phone();
    const file = await createShareKit(p.env).prepare("/i/abc", "instagram-square.png");
    expect(p.fetchMock).toHaveBeenCalledWith("/i/abc", { credentials: "same-origin" });
    expect(file).toBeInstanceOf(File);
    expect(file!.name).toBe("instagram-square.png");
    expect(file!.type).toBe("image/png");
    expect(file!.size).toBe(3);
  });
  it("uses image/jpeg for a .jpg name when the response has no image type", async () => {
    const file = await createShareKit(phone({ blobType: "" }).env).prepare("/i/abc", "post.jpg");
    expect(file!.type).toBe("image/jpeg");
    const png = await createShareKit(phone({ blobType: "" }).env).prepare("/i/abc", "post.png");
    expect(png!.type).toBe("image/png");
  });
  it("returns null when the picture cannot be fetched", async () => {
    expect(await createShareKit(phone({ fetchOk: false }).env).prepare("/i/x", "a.png")).toBeNull();
    const broken = phone();
    broken.fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await createShareKit(broken.env).prepare("/i/x", "a.png")).toBeNull();
  });
});

describe("Share", () => {
  it("copies the caption first, then calls navigator.share with the File and the text", async () => {
    const p = phone();
    const kit = createShareKit(p.env);
    const file = (await kit.prepare("/i/sq", "instagram-square.png"))!;
    const out = await kit.share(file, "Fresh bread\n\nCall us #bakery");
    expect(out).toEqual({ kind: "shared", copied: true });
    expect(p.calls.slice(-2)).toEqual(["copy:Fresh bread\n\nCall us #bakery", "share"]);
    expect(p.shareArgs).toHaveLength(1);
    expect(p.shareArgs[0].text).toBe("Fresh bread\n\nCall us #bakery");
    expect(p.shareArgs[0].files).toHaveLength(1);
    expect(p.shareArgs[0].files![0]).toBe(file);
    expect(p.shareArgs[0].files![0].type).toBe("image/png");
  });

  it("still shares when the clipboard is not allowed", async () => {
    const p = phone();
    (p.nav.clipboard!.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("denied"));
    const kit = createShareKit(p.env);
    const out = await kit.share((await kit.prepare("/i/sq", "a.png"))!, "text");
    expect(out).toEqual({ kind: "shared", copied: false });
    expect(p.nav.share).toHaveBeenCalledTimes(1);
  });

  it("ignores AbortError (the owner closed the share sheet), without throwing", async () => {
    const p = phone({ share: async () => { throw Object.assign(new Error("Share canceled"), { name: "AbortError" }); } });
    const kit = createShareKit(p.env);
    const out = await kit.share((await kit.prepare("/i/sq", "a.png"))!, "text");
    expect(out.kind).toBe("cancelled");
  });

  it("reports any other error with its name (NotAllowedError is a tap that came too late)", async () => {
    const p = phone({ share: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    const kit = createShareKit(p.env);
    const out = await kit.share((await kit.prepare("/i/sq", "a.png"))!, "text");
    expect(out).toMatchObject({ kind: "error", name: "NotAllowedError" });
  });

  it("falls back (unsupported) without calling share when canShare says no for the file", async () => {
    const p = phone({ canShare: () => false });
    const kit = createShareKit(p.env);
    const file = (await kit.prepare("/i/sq", "a.png"))!;
    const out = await kit.share(file, "text");
    expect(out.kind).toBe("unsupported");
    expect(p.nav.share).not.toHaveBeenCalled();
  });

  it("a carousel shares all its slides as files, in order, in one share sheet", async () => {
    const p = phone();
    const kit = createShareKit(p.env);
    const files = (await Promise.all([1, 2, 3].map((n) => kit.prepare(`/i/s${n}`, `instagram-slide-${n}.png`)))) as File[];
    const out = await kit.share(files, "Three things we love");
    expect(out).toEqual({ kind: "shared", copied: true });
    expect(p.shareArgs).toHaveLength(1);
    expect(p.shareArgs[0].files!.map((f) => f.name)).toEqual(["instagram-slide-1.png", "instagram-slide-2.png", "instagram-slide-3.png"]);
  });

  it("falls back to Download when the browser cannot share that many files", async () => {
    const p = phone({ canShare: (d) => (d.files?.length ?? 0) <= 1 });
    const kit = createShareKit(p.env);
    const files = (await Promise.all([1, 2].map((n) => kit.prepare(`/i/s${n}`, `a-${n}.png`)))) as File[];
    expect((await kit.share(files, "text")).kind).toBe("unsupported");
    expect(p.nav.share).not.toHaveBeenCalled();
  });

  it("the story path shares the vertical picture", async () => {
    const p = phone();
    const kit = createShareKit(p.env);
    const file = (await kit.prepare("/i/vertical-token", shareFilename("instagram", STORY_FORMAT)))!;
    await kit.share(file, "text");
    expect(p.shareArgs[0].files![0].name).toBe("instagram-vertical.png");
    expect(p.calls).toContain("fetch:/i/vertical-token");
  });
});

describe("Copy caption", () => {
  it("uses the clipboard API", async () => {
    const p = phone();
    expect(await createShareKit(p.env).copyText("hello")).toBe(true);
    expect(p.nav.clipboard!.writeText).toHaveBeenCalledWith("hello");
  });
  it("falls back to select-and-copy in a textarea when there is no clipboard API", async () => {
    const p = phone({ clipboard: false });
    const area = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn() };
    const document = { createElement: vi.fn(() => area), body: { appendChild: vi.fn(), removeChild: vi.fn() }, execCommand: vi.fn(() => true) };
    const out = await createShareKit({ ...p.env, document }).copyText("hello there");
    expect(out).toBe(true);
    expect(document.createElement).toHaveBeenCalledWith("textarea");
    expect(area.value).toBe("hello there");
    expect(area.select).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.body.removeChild).toHaveBeenCalledWith(area);
  });
  it("falls back when the clipboard API refuses, and says false when nothing works", async () => {
    const p = phone();
    (p.nav.clipboard!.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("denied"));
    const area = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    const document = { createElement: () => area, body: { appendChild: vi.fn(), removeChild: vi.fn() }, execCommand: vi.fn(() => true) };
    expect(await createShareKit({ ...p.env, document }).copyText("x")).toBe(true);
    expect(await createShareKit(phone({ clipboard: false }).env).copyText("x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The script of the no-login ready page, run against a tiny fake page.
// ---------------------------------------------------------------------------------------------

class FakeEl {
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<() => unknown>>();
  children: FakeEl[] = [];
  hidden: boolean;
  textContent = "";
  constructor(attrs: Record<string, string> = {}, hidden = false) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    this.hidden = hidden;
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  addEventListener(type: string, fn: () => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  async click() {
    for (const fn of this.listeners.get("click") ?? []) await fn();
  }
  querySelectorAll(sel: string): FakeEl[] {
    const name = /^\[([\w-]+)\]$/.exec(sel)![1];
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        if (c.attrs.has(name)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

function fakePage(canShare: boolean) {
  const doc = new FakeEl();
  const root = new FakeEl({ "data-share-root": "", "data-post": "11111111-1111-4111-8111-111111111111", "data-text": "Caption text", "data-token": "TOKEN", "data-nonce": "NONCE" });
  const shareBtn = new FakeEl({ "data-share-btn": "", "data-url": "/i/square-tok", "data-filename": "instagram-square.png", "data-format": "square", "data-default": "1" });
  const storyBtn = new FakeEl({ "data-share-btn": "", "data-url": "/i/vertical-tok", "data-filename": "instagram-vertical.png", "data-format": "vertical", "data-story": "1" });
  const download = new FakeEl({ "data-download-link": "", "data-format": "square" });
  const copyBtn = new FakeEl({ "data-copy-btn": "" });
  const msg = new FakeEl({ "data-share-msg": "" }, true);
  const prompt = new FakeEl({ "data-share-prompt": "" }, true);
  const needsShare = new FakeEl({ "data-needs-share": "" }, true);
  const noShare = new FakeEl({ "data-no-share": "" }, false);
  const jsOnly = new FakeEl({ "data-js-only": "" }, true);
  const ios = new FakeEl({ "data-ios-hint": "" }, true);
  root.children = [needsShare, noShare, jsOnly, msg, prompt, shareBtn, storyBtn, download, copyBtn, ios];
  doc.children = [root];

  const p = phone({ canShare: canShare ? undefined : () => false });
  const posts: Array<{ url: string; body: Map<string, string> }> = [];
  const win = {
    document: doc,
    navigator: p.nav,
    File,
    FormData: class {
      m = new Map<string, string>();
      set(k: string, v: string) {
        this.m.set(k, v);
      }
    },
    fetch: vi.fn(async (url: string, init?: { method?: string; body?: { m: Map<string, string> } }) => {
      if (init?.method === "POST") {
        posts.push({ url, body: init.body!.m });
        return { ok: true, blob: async () => new Blob([]) };
      }
      return p.fetchMock(url);
    }),
  };
  return { win, p, posts, el: { shareBtn, storyBtn, download, copyBtn, msg, prompt, needsShare, noShare, jsOnly } };
}

describe("the ready page script", () => {
  it("is plain JavaScript that carries the share code and no user data", () => {
    const js = sharePageScript();
    expect(() => new Function("window", js)).not.toThrow();
    expect(js).toContain("canShare");
    expect(js).not.toContain("</script");
    expect(js).toContain(sharePageText().pasteHint);
  });

  it("on a phone that can share: shows Share, hides Download, shares the picture, copies the caption first and logs it", async () => {
    const page = fakePage(true);
    new Function("window", sharePageScript())(page.win);
    expect(page.el.needsShare.hidden).toBe(false);
    expect(page.el.noShare.hidden).toBe(true);
    expect(page.el.jsOnly.hidden).toBe(false);

    await page.el.shareBtn.click();
    expect(page.p.shareArgs).toHaveLength(1);
    expect(page.p.shareArgs[0].text).toBe("Caption text");
    expect(page.p.shareArgs[0].files![0].name).toBe("instagram-square.png");
    expect(page.p.shareArgs[0].files![0].type).toBe("image/png");
    expect(page.p.calls.indexOf("copy:Caption text")).toBeLessThan(page.p.calls.indexOf("share"));
    expect(page.el.msg.textContent).toBe(sharePageText().pasteHint);
    expect(page.el.prompt.hidden).toBe(false);
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].url).toBe("/e/TOKEN");
    expect(Object.fromEntries(page.posts[0].body)).toMatchObject({ nonce: "NONCE", op: "log", kind: "share", format: "square", post: "11111111-1111-4111-8111-111111111111" });
  });

  it("a carousel's Share button shares every slide as files in one go and logs it once", async () => {
    const page = fakePage(true);
    page.el.shareBtn.setAttribute("data-urls", "/i/s1 /i/s2 /i/s3");
    page.el.shareBtn.setAttribute("data-filenames", "instagram-slide-1.png instagram-slide-2.png instagram-slide-3.png");
    new Function("window", sharePageScript())(page.win);
    await page.el.shareBtn.click();
    expect(page.p.shareArgs).toHaveLength(1);
    expect(page.p.shareArgs[0].files!.map((f) => f.name)).toEqual(["instagram-slide-1.png", "instagram-slide-2.png", "instagram-slide-3.png"]);
    expect(page.p.calls.filter((c) => c.startsWith("fetch:"))).toEqual(["fetch:/i/s1", "fetch:/i/s2", "fetch:/i/s3"]);
    expect(page.posts).toHaveLength(1);
  });

  it("Share as story or status shares the vertical picture and logs the story flag", async () => {
    const page = fakePage(true);
    new Function("window", sharePageScript())(page.win);
    await page.el.storyBtn.click();
    expect(page.p.shareArgs[0].files![0].name).toBe("instagram-vertical.png");
    expect(page.p.calls).toContain("fetch:/i/vertical-tok");
    expect(Object.fromEntries(page.posts[0].body)).toMatchObject({ kind: "share", format: "vertical", story: "1" });
  });

  it("a closed share sheet logs nothing and shows no message", async () => {
    const page = fakePage(true);
    page.p.nav.share.mockImplementationOnce(async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    });
    new Function("window", sharePageScript())(page.win);
    await page.el.shareBtn.click();
    expect(page.posts).toHaveLength(0);
    expect(page.el.msg.hidden).toBe(true);
    expect(page.el.prompt.hidden).toBe(true);
  });

  it("on a desktop: keeps the Download links, hides Share, and a download is logged", async () => {
    const page = fakePage(false);
    new Function("window", sharePageScript())(page.win);
    expect(page.el.needsShare.hidden).toBe(true);
    expect(page.el.noShare.hidden).toBe(false);
    await page.el.download.click();
    expect(page.posts).toHaveLength(1);
    expect(Object.fromEntries(page.posts[0].body)).toMatchObject({ kind: "download", format: "square" });
    expect(page.el.prompt.hidden).toBe(false);
  });

  it("H-11: Share and Share as story stay hidden when navigator.canShare is missing or says no, and show when it says yes", () => {
    const run = (setup: (p: ReturnType<typeof fakePage>) => void) => {
      const page = fakePage(true);
      setup(page);
      new Function("window", sharePageScript())(page.win);
      return page.el;
    };
    const missing = run((p) => delete (p.p.nav as { canShare?: unknown }).canShare);
    expect(missing.needsShare.hidden).toBe(true);
    expect(missing.noShare.hidden).toBe(false);
    const refused = run((p) => ((p.p.nav as { canShare: unknown }).canShare = () => false));
    expect(refused.needsShare.hidden).toBe(true);
    expect(refused.noShare.hidden).toBe(false);
    const supported = run(() => undefined);
    expect(supported.needsShare.hidden).toBe(false);
    expect(supported.noShare.hidden).toBe(true);
    // the probe is called with a file, not an empty list
    const page = fakePage(true);
    const seen: Array<number> = [];
    (page.p.nav as { canShare: unknown }).canShare = (d: { files?: File[] }) => (seen.push(d.files?.length ?? 0), true);
    new Function("window", sharePageScript())(page.win);
    expect(seen[0]).toBe(1);
  });

  it("H-11: no failure message is shown until something really fails", async () => {
    const page = fakePage(false);
    new Function("window", sharePageScript())(page.win);
    expect(page.el.msg.hidden).toBe(true);
    expect(page.el.msg.textContent).toBe("");
    const ok = fakePage(true);
    new Function("window", sharePageScript())(ok.win);
    expect(ok.el.msg.hidden).toBe(true);
    expect(ok.el.msg.textContent).toBe("");
    ok.p.nav.share.mockImplementationOnce(async () => {
      throw Object.assign(new Error("boom"), { name: "DataError" });
    });
    await ok.el.shareBtn.click();
    expect(ok.el.msg.textContent).toBe(sharePageText().shareFailed);
    expect(ok.el.msg.hidden).toBe(false);
  });

  it("Copy caption copies and is not logged", async () => {
    const page = fakePage(true);
    new Function("window", sharePageScript())(page.win);
    await page.el.copyBtn.click();
    expect(page.p.calls).toContain("copy:Caption text");
    expect(page.el.msg.textContent).toBe(sharePageText().copied);
    expect(page.posts).toHaveLength(0);
  });

  it("bindShareDom is the same function the page script sends", () => {
    expect(sharePageScript()).toContain(bindShareDom.toString());
    expect(sharePageScript()).toContain(createShareKit.toString());
  });
});

describe("the dashboard ShareButtons (H-11)", () => {
  it("leads with Download and Copy, and does not draw Share or Share as story until the browser is known to share files", () => {
    const html = renderToString(
      createElement(ShareButtons, {
        postId: "p1",
        channel: "instagram",
        images: { square: "/i/sq", vertical: "/i/v", landscape: "/i/l" },
        shareText: "Fresh bread",
        busy: false,
        onLog: () => undefined,
        onMarkPosted: () => undefined,
      }),
    );
    expect(html).not.toContain(`>${s.share.share}<`);
    expect(html).not.toContain(s.share.shareStory);
    expect(html).toContain(s.share.downloadFormat.square);
    expect(html).toContain(s.share.copyCaption);
    expect(html).not.toContain(s.share.shareFailed.slice(0, 15));
  });
});
