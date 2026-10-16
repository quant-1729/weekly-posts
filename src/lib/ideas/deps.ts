// The outside world of a research run, as injectable dependencies. Everything that makes a network call or
// reads a token goes through here, so tests run with fixtures and never touch Google, Meta or YouTube.

import { generateGrounded, generateJson } from "@/lib/ai/client";
import { getConnection } from "@/lib/connections/service";
import { readToken } from "@/lib/connections/tokens";
import type { FetchLike } from "@/lib/connections/graph";
import { loadWebsitePages, type LoadResult } from "@/lib/website/load";

export interface AiDeps {
  /** Same contract as generateJson in src/lib/ai/client.ts. */
  json: typeof generateJson;
  /** Same contract as generateGrounded in src/lib/ai/client.ts. */
  grounded: typeof generateGrounded;
}

export interface ResearchDeps {
  ai: AiDeps;
  /** Reads a competitor's website (robots.txt respected). */
  loadSite: (url: string) => Promise<LoadResult>;
  /** Plain fetch for the YouTube Data API and the Graph API. */
  fetch: FetchLike;
  /** The brand's connection and token, for Business Discovery. */
  getConnection: typeof getConnection;
  readToken: typeof readToken;
  /** Environment switches and keys; tests pass their own. */
  env: Record<string, string | undefined>;
}

export function defaultDeps(): ResearchDeps {
  return {
    ai: { json: generateJson, grounded: generateGrounded },
    loadSite: (url) => loadWebsitePages(url),
    fetch: (input, init) => fetch(input, init),
    getConnection,
    readToken,
    env: process.env,
  };
}

export function withDeps(overrides: Partial<ResearchDeps> = {}): ResearchDeps {
  const base = defaultDeps();
  return { ...base, ...overrides, ai: { ...base.ai, ...(overrides.ai ?? {}) } };
}
