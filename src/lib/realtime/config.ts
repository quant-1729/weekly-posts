// Live status (docs/14-firebase-plan.md §5, §7): which backend carries the tiny brand-scoped status documents.
//   firestore  server writes with firebase-admin, browsers listen with onSnapshot
//   mock       an in-memory recorder: no network, the UI behaves exactly as without live status
//   off        nothing is written and the token route answers { mode: 'off' }

export type RealtimeMode = 'firestore' | 'mock' | 'off';

/** The browser Firebase config, served at runtime by /api/live/token (never NEXT_PUBLIC_*; the key is public by design). */
export interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

type Env = Record<string, string | undefined>;

const filled = (v: string | undefined): string | undefined => (v && v.trim() !== '' ? v.trim() : undefined);

/**
 * Always 'mock' under vitest; else REALTIME_BACKEND when valid; else 'firestore' once the project id, web API key and
 * web app id are set; else 'mock' for the local mock backend; else 'off'. `env` is a parameter so tests can try every case.
 */
export function realtimeMode(env: Env = process.env): RealtimeMode {
  if (env.VITEST) return 'mock';
  const forced = filled(env.REALTIME_BACKEND)?.toLowerCase();
  if (forced === 'firestore' || forced === 'mock' || forced === 'off') return forced;
  if (filled(env.FIREBASE_PROJECT_ID) && filled(env.FIREBASE_WEB_API_KEY) && filled(env.FIREBASE_WEB_APP_ID)) return 'firestore';
  if (filled(env.DATA_BACKEND)?.toLowerCase() === 'mock') return 'mock';
  return 'off';
}

/** The browser config, or null while the project id, API key or app id is missing. */
export function webConfig(env: Env = process.env): WebConfig | null {
  const projectId = filled(env.FIREBASE_PROJECT_ID);
  const apiKey = filled(env.FIREBASE_WEB_API_KEY);
  const appId = filled(env.FIREBASE_WEB_APP_ID);
  if (!projectId || !apiKey || !appId) return null;
  return { apiKey, authDomain: filled(env.FIREBASE_AUTH_DOMAIN) ?? `${projectId}.firebaseapp.com`, projectId, appId };
}
