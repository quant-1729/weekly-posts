// Made-up Business Discovery answers for development (INSTAGRAM_MODE=fixture) and tests, so the whole
// flow works with no Meta app. The shapes follow what Graph returns; the pictures are small
// SVG data addresses (so the browser can show them with no network) that fixture mode turns into JPEGs.
//
// Handle names pick the case:
//   personal*  -> a personal account (error)         missing*  -> no such account (error)
//   limited*   -> rate limited (HTTP 429)            badtoken* -> token problem (error 190)
//   empty*     -> a business account with no posts   anything else -> a business account with 16 posts

function svg(label: string, color: string): string {
  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">` +
    `<rect width="640" height="640" fill="${color}"/><circle cx="320" cy="320" r="160" fill="#ffffff" fill-opacity="0.35"/>` +
    `<rect x="120" y="470" width="400" height="24" rx="12" fill="#ffffff" fill-opacity="0.5"/></svg>`;
  void label;
  return `data:image/svg+xml;utf8,${encodeURIComponent(body)}`;
}

const COLORS = ["#c0392b", "#d68910", "#27ae60", "#2980b9", "#8e44ad", "#16a085", "#7f8c8d", "#e67e22"];

const CAPTIONS = [
  "Fresh out of the oven this morning. Come in and say hello, the kettle is on!",
  "Thank you for a lovely week, everyone. See you on Saturday for something sweet.",
  "New on the counter today. Made by hand, made with love. Pop in and try one.",
  "Saturday market stall is back! Find us by the fountain from 9. #localmarket",
  "Behind the scenes: shaping the dough before sunrise. Worth every early alarm.",
  "Our regulars know the best loaf goes by noon. Come early!",
  "A little thank you to everyone who stopped by this week.",
  "Quiet Monday, warm kitchen. Cinnamon is in the air.",
  "Custom orders open for the weekend. Message us to book yours.",
  "Rainy day special: soup and a roll, just right.",
  "Meet the team who makes it all happen. Say hi next time you visit!",
  "We are closed on Sunday this week, back on Monday morning.",
];

function post(handle: string, i: number): Record<string, unknown> {
  const tag = [...handle].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1_000_000, 7);
  const id = `1784${String(tag).padStart(6, "0")}${String(1000 + i)}`;
  const when = new Date(Date.UTC(2026, 9, 10 - i, 9, 30)).toISOString().replace(".000Z", "+0000");
  const base = { id, timestamp: when, permalink: `https://www.instagram.com/p/FIX${id.slice(-8)}/` };
  const color = COLORS[i % COLORS.length];
  const caption = CAPTIONS[i % CAPTIONS.length];
  switch (i) {
    case 2: // a video: media_url is the video file, only the thumbnail is a picture
      return { ...base, caption, media_type: "VIDEO", media_url: "https://video.cdninstagram.com/fixture/clip.mp4", thumbnail_url: svg(id, color) };
    case 4: // a carousel: the first child is the picture we use
      return {
        ...base,
        caption,
        media_type: "CAROUSEL_ALBUM",
        media_url: svg(id, color),
        children: { data: [{ media_type: "IMAGE", media_url: svg(`${id}a`, color) }, { media_type: "IMAGE", media_url: svg(`${id}b`, "#34495e") }] },
      };
    case 6: // no caption at all
      return { ...base, media_type: "IMAGE", media_url: svg(id, color) };
    case 7: // a caption that is too short to learn from
      return { ...base, caption: "Yum!", media_type: "IMAGE", media_url: svg(id, color) };
    default:
      return { ...base, caption, media_type: "IMAGE", media_url: svg(id, color) };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A stand-in for fetch(graph.facebook.com/...). */
export async function fixtureGraphFetch(input: string | URL | Request): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const fields = new URL(raw).searchParams.get("fields") ?? "";
  const handle = /business_discovery\.username\(([^)]*)\)/.exec(fields)?.[1] ?? "";

  if (handle.startsWith("personal")) {
    return json(400, { error: { message: "This account is not a business or creator account", type: "OAuthException", code: 110, fbtrace_id: "FIXTURE" } });
  }
  if (handle.startsWith("missing")) {
    return json(400, { error: { message: "Invalid user id", type: "OAuthException", code: 110, fbtrace_id: "FIXTURE" } });
  }
  if (handle.startsWith("limited")) {
    return json(429, { error: { message: "(#4) Application request limit reached", type: "OAuthException", code: 4, fbtrace_id: "FIXTURE" } });
  }
  if (handle.startsWith("badtoken")) {
    return json(400, { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463, fbtrace_id: "FIXTURE" } });
  }
  const count = handle.startsWith("empty") ? 0 : 16;
  return json(200, {
    business_discovery: {
      username: handle,
      name: `${handle} (fixture)`,
      followers_count: 1200,
      media_count: count,
      media: { data: Array.from({ length: count }, (_, i) => post(handle, i)) },
    },
    id: "17841400000000000",
  });
}
