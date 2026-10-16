import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFacebookInsights } from "@/lib/insights/facebook";
import { fetchInstagramInsights, IG_METRICS } from "@/lib/insights/instagram";
import { InsightsError } from "@/lib/insights/types";
import { FB_TOKEN, IG_TOKEN, fakeFetch, graphError, igBody, when } from "./helpers";

beforeEach(() => vi.stubEnv("META_GRAPH_VERSION", "v23.0"));
afterEach(() => vi.unstubAllEnvs());

const metricsOf = (c: { params: URLSearchParams }) => (c.params.get("metric") ?? "").split(",");

describe("Instagram insights: metrics per media type", () => {
  it("asks graph.instagram.com for the metrics of each kind and maps them into the post_metrics fields", async () => {
    const cases = [
      { kind: "feed" as const, expect: { reach: 10, likes: 20, comments: 30, saves: 40, shares: 50, views: 60 } },
      { kind: "carousel" as const, expect: { reach: 10, likes: 20, comments: 30, saves: 40, shares: 50, views: 60 } },
      { kind: "reel" as const, expect: { reach: 10, likes: 20, comments: 30, saves: 40, shares: 50, views: 60 } },
      // Story replies count as comments.
      { kind: "story" as const, expect: { reach: 10, comments: 20, views: 30 } },
    ];
    for (const c of cases) {
      const f = fakeFetch([when("GET", /\/insights$/, (call) => ({ body: igBody(metricsOf(call)) }))]);
      const out = await fetchInstagramInsights({ mediaId: "179001", kind: c.kind, token: IG_TOKEN, fetch: f.fetch });
      expect(out.metrics, c.kind).toEqual(c.expect);
      expect(out.skipped).toEqual([]);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toMatchObject({ method: "GET", host: "graph.instagram.com", path: "/v23.0/179001/insights" });
      expect(metricsOf(f.calls[0])).toEqual([...IG_METRICS[c.kind]]);
      expect(f.calls[0].params.get("access_token")).toBe(IG_TOKEN);
    }
    // Feed and carousel never ask for story-only metrics, and nothing asks for the retired "impressions".
    expect(IG_METRICS.feed).not.toContain("replies");
    expect(IG_METRICS.story).not.toContain("likes");
    for (const k of Object.values(IG_METRICS)) expect(k).not.toContain("impressions");
  });

  it("understands the total_value answer shape too", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, (call) => ({ body: igBody(metricsOf(call), "total") }))]);
    const out = await fetchInstagramInsights({ mediaId: "1", kind: "reel", token: IG_TOKEN, fetch: f.fetch });
    expect(out.metrics).toMatchObject({ reach: 10, saves: 40, views: 60 });
  });

  it("a refused (deprecated) metric is skipped and the others are kept", async () => {
    const f = fakeFetch([
      when("GET", /\/insights$/, (call) => {
        const names = metricsOf(call);
        if (names.includes("views")) return graphError(100, "(#100) metric[5] must be one of the following values: reach, likes, comments, saved, shares", { type: "OAuthException" });
        return { body: igBody(names) };
      }),
    ]);
    const out = await fetchInstagramInsights({ mediaId: "1", kind: "feed", token: IG_TOKEN, fetch: f.fetch });
    expect(out.skipped).toEqual(["views"]);
    expect(out.metrics).toEqual({ reach: 10, likes: 10, comments: 10, saves: 10, shares: 10 });
    expect(out.metrics.views).toBeUndefined();
    // One combined call, then one per metric.
    expect(f.calls).toHaveLength(1 + IG_METRICS.feed.length);
  });

  it("when every metric is refused it returns nothing, not an error", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, graphError(100, "Unsupported get request"))]);
    const out = await fetchInstagramInsights({ mediaId: "1", kind: "story", token: IG_TOKEN, fetch: f.fetch });
    expect(out.metrics).toEqual({});
    expect(out.skipped).toEqual([...IG_METRICS.story]);
  });

  it("a missing permission, a bad token and a busy Meta stop the fetch, with the token scrubbed from the message", async () => {
    const cases: Array<[string, ReturnType<typeof graphError>, string]> = [
      ["permission", graphError(10, `(#10) Application does not have permission for this action access_token=${IG_TOKEN}`), "permission"],
      ["permission", graphError(200, "Requires instagram_business_manage_insights"), "permission"],
      ["token", graphError(190, `Invalid OAuth access token ${IG_TOKEN}`, { status: 401 }), "token"],
      ["transient", { status: 500, body: { error: { message: `server down ${IG_TOKEN}`, code: 2 } } }, "transient"],
      ["transient", graphError(4, "Application request limit reached", { status: 429 }), "transient"],
    ];
    for (const [, reply, kind] of cases) {
      const f = fakeFetch([when("GET", /\/insights$/, reply)]);
      const err = await fetchInstagramInsights({ mediaId: "1", kind: "feed", token: IG_TOKEN, fetch: f.fetch }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InsightsError);
      expect((err as InsightsError).kind).toBe(kind);
      expect((err as InsightsError).message).not.toContain(IG_TOKEN);
      expect(f.calls).toHaveLength(1); // no per-metric retries for these
    }
  });

  it("an unreachable Meta is transient", async () => {
    const f = fakeFetch([() => new Error("socket hang up")]);
    const err = await fetchInstagramInsights({ mediaId: "1", kind: "feed", token: IG_TOKEN, fetch: f.fetch }).catch((e: unknown) => e);
    expect((err as InsightsError).kind).toBe("transient");
  });
});

describe("Facebook Page post insights", () => {
  const postAnswer = { shares: { count: 4 }, comments: { data: [], summary: { total_count: 7, order: "ranked", can_comment: true } }, id: "100_200" };
  const insightsAnswer = {
    data: [
      { name: "post_impressions_unique", period: "lifetime", values: [{ value: 320 }] },
      { name: "post_impressions", period: "lifetime", values: [{ value: 410 }] },
      { name: "post_reactions_by_type_total", period: "lifetime", values: [{ value: { like: 12, love: 3, wow: 1 } }] },
      { name: "post_media_view", period: "lifetime", values: [{ value: 500 }] },
    ],
  };

  it("maps reach, impressions, reactions (added up), views, shares and comments", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, { body: insightsAnswer }), when("GET", /\/100_200$/, { body: postAnswer })]);
    const out = await fetchFacebookInsights({ postId: "100_200", token: FB_TOKEN, fetch: f.fetch });
    expect(out.metrics).toEqual({ reach: 320, impressions: 410, likes: 16, views: 500, shares: 4, comments: 7 });
    expect(out.skipped).toEqual([]);
    expect(f.calls[0]).toMatchObject({ host: "graph.facebook.com", path: "/v23.0/100_200/insights" });
    expect(metricsOf(f.calls[0])).toEqual(["post_impressions_unique", "post_impressions", "post_reactions_by_type_total", "post_media_view"]);
    expect(f.calls[1].params.get("fields")).toBe("shares,comments.summary(true)");
  });

  it("a post nobody shared has no shares field: zero shares", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, { body: insightsAnswer }), when("GET", /\/100_200$/, { body: { comments: { summary: { total_count: 0 } } } })]);
    const out = await fetchFacebookInsights({ postId: "100_200", token: FB_TOKEN, fetch: f.fetch });
    expect(out.metrics).toMatchObject({ shares: 0, comments: 0 });
  });

  it("a deprecated metric is skipped and the rest kept", async () => {
    const f = fakeFetch([
      when("GET", /\/insights$/, (call) => {
        const names = metricsOf(call);
        if (names.includes("post_impressions")) return graphError(100, "(#100) The value must be a valid insights metric");
        return { body: { data: insightsAnswer.data.filter((d) => names.includes(d.name)) } };
      }),
      when("GET", /\/100_200$/, { body: postAnswer }),
    ]);
    const out = await fetchFacebookInsights({ postId: "100_200", token: FB_TOKEN, fetch: f.fetch });
    expect(out.skipped).toEqual(["post_impressions"]);
    expect(out.metrics).toEqual({ reach: 320, likes: 16, views: 500, shares: 4, comments: 7 });
  });

  it("a missing read_insights permission stops the fetch, token scrubbed", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, graphError(200, `(#200) Requires read_insights permission access_token=${FB_TOKEN}`))]);
    const err = await fetchFacebookInsights({ postId: "100_200", token: FB_TOKEN, fetch: f.fetch }).catch((e: unknown) => e);
    expect((err as InsightsError).kind).toBe("permission");
    expect((err as InsightsError).message).not.toContain(FB_TOKEN);
  });

  it("if shares/comments cannot be read, the insights are still returned", async () => {
    const f = fakeFetch([when("GET", /\/insights$/, { body: insightsAnswer }), when("GET", /\/100_200$/, graphError(100, "Unsupported get request"))]);
    const out = await fetchFacebookInsights({ postId: "100_200", token: FB_TOKEN, fetch: f.fetch });
    expect(out.metrics).toMatchObject({ reach: 320, likes: 16 });
    expect(out.skipped).toContain("shares,comments");
  });
});
