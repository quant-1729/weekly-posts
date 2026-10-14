/** Imported past posts kept per brand (older ones roll off when a refresh brings newer ones). */
export const MAX_IMPORTED_POSTS = 12;
/** Instagram photos the owner can pick in one go. */
export const MAX_PICK_PHOTOS = 12;
/** Cached Instagram answers are reused for this long (Meta allows about 200 calls an hour per token). */
export const CACHE_MS = 15 * 60_000;
/** The Graph call gives up after this long. */
export const GRAPH_TIMEOUT_MS = 15_000;
