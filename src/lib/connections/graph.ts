// One small HTTP helper for Meta's APIs (Instagram Login, Facebook Login, Graph). Used by the connect
// flows, the refresh job and the publisher. Tokens and app secrets go in the query (GET) or the form body
// (POST), never in a header we might log, and every error message is scrubbed of them before it leaves here.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const GRAPH_TIMEOUT_MS = 20_000;

export class GraphError extends Error {
  readonly httpStatus: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  constructor(args: { httpStatus: number; code?: number | null; subcode?: number | null; type?: string | null; message: string }) {
    super(args.message);
    this.name = "GraphError";
    this.httpStatus = args.httpStatus;
    this.code = args.code ?? null;
    this.subcode = args.subcode ?? null;
    this.type = args.type ?? null;
  }
}

/** Removes secrets and anything that looks like a token parameter from text. */
export function scrub(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[hidden]");
  }
  return out
    .replace(/(access_token|client_secret|fb_exchange_token|ig_exchange_token)=[^&\s"']+/gi, "$1=[hidden]")
    .replace(/\b(EAA|IGQ|IGA)[A-Za-z0-9_-]{20,}/g, "[hidden]");
}

export interface GraphCall {
  method?: "GET" | "POST" | "DELETE";
  url: string;
  params?: Record<string, string | number | boolean | undefined>;
  /** Sent as access_token. */
  token?: string;
  /** Other values to scrub from errors (an app secret). */
  secrets?: readonly (string | undefined)[];
  fetch?: FetchLike;
  timeoutMs?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/** Calls the API and returns the parsed JSON, or throws GraphError (httpStatus 0 = could not reach Meta). */
export async function graphRequest<T = Record<string, unknown>>(call: GraphCall): Promise<T> {
  const method = call.method ?? "GET";
  const secrets = [call.token, ...(call.secrets ?? [])];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(call.params ?? {})) if (v !== undefined) params.set(k, String(v));
  if (call.token) params.set("access_token", call.token);

  let url = call.url;
  const init: RequestInit = { method, signal: AbortSignal.timeout(call.timeoutMs ?? GRAPH_TIMEOUT_MS), cache: "no-store" };
  if (method === "POST") {
    init.body = params;
    init.headers = { "content-type": "application/x-www-form-urlencoded" };
  } else {
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  let res: Response;
  try {
    res = await (call.fetch ?? fetch)(url, init);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new GraphError({ httpStatus: 0, message: timedOut ? "Meta did not answer in time." : "Could not reach Meta." });
  }

  let body: unknown = null;
  const text = await res.text().catch(() => "");
  try {
    // Instagram account ids are 17 digits; as JSON numbers they would lose digits. Read long digit runs after an id key as strings.
    body = text ? JSON.parse(text.replace(/("(?:user_id|id)"\s*:\s*)(\d{15,})/g, '$1"$2"')) : null;
  } catch {
    body = null;
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

  // Graph API: { error: { message, type, code, error_subcode } }. Instagram OAuth: { error_type, code, error_message }.
  const err = obj && obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  if (err || (obj && typeof obj.error_message === "string") || !res.ok) {
    const raw = typeof err?.message === "string" ? err.message : typeof obj?.error_message === "string" ? obj.error_message : `HTTP ${res.status}`;
    throw new GraphError({
      httpStatus: res.status,
      code: num(err?.code ?? obj?.code),
      subcode: num(err?.error_subcode),
      type: typeof err?.type === "string" ? err.type : typeof obj?.error_type === "string" ? obj.error_type : null,
      message: scrub(raw, secrets).slice(0, 300),
    });
  }
  if (obj === null) throw new GraphError({ httpStatus: res.status, message: "Meta sent an answer we could not read." });
  return obj as T;
}
