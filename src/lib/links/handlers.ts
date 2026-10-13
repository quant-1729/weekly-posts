import type { LinkPage } from "./page";
import type { LinkAct, LinkClaims } from "./tokens";

/**
 * Registry of what each link act does. src/app/e/[token] looks the handler up by `act`.
 * Later tasks add theirs with registerLinkHandler (V-16: approve, skip, edit, ready) in a
 * module that src/lib/links/load.ts imports; registering an act again replaces the earlier one.
 */

export type PostActionName = "approve" | "skip" | "edit" | "rewrite" | "swap_photo" | "posted" | "share" | "download" | "undo";

export interface LinkBrand {
  id: string;
  name: string;
  timezone: string;
  /** "YYYY-MM-DD" or null. */
  emailPausedUntil: string | null;
  emailUnsubscribedAt: Date | null;
}

export interface LinkContext {
  /** The token as it appears in the URL. Pass it to postForm(). */
  token: string;
  claims: LinkClaims;
  /** CSRF nonce for forms on this page (pass it to postForm()). */
  nonce: string;
  /** Short hash of the jti, for logs. */
  jtiHash: string;
  now: Date;
  brand: LinkBrand;
  /**
   * Writes a post_actions row (via 'email_link', user null, detail.jti_hash). Call it after a post act
   * succeeded. Only for tokens that carry a post id.
   */
  logPostAction(action: PostActionName, detail?: Record<string, unknown>): Promise<void>;
}

export interface LinkHandler {
  /** GET: show what will happen. Must not change anything. */
  view(ctx: LinkContext): Promise<LinkPage>;
  /** POST (nonce already checked): do it, then return the result page. */
  act(ctx: LinkContext, form: FormData): Promise<LinkPage>;
}

const registry = new Map<LinkAct, LinkHandler>();

export function registerLinkHandler(act: LinkAct, handler: LinkHandler): void {
  registry.set(act, handler);
}

export function getLinkHandler(act: LinkAct): LinkHandler | undefined {
  return registry.get(act);
}
