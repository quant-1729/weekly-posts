/**
 * Limits on unprompted behaviour (mascot.md 3.7): at most one unprompted bubble per page view and three per session,
 * none on the form page, none while the menu, a lightbox or a form is active, none after the visitor hid or quieted
 * Tween, and each kind of nudge once per session. Pure: the component keeps the counters.
 */
export type UnpromptedKind = "greeting" | "tip" | "nudge";

export type Budget = {
  sessionCount: number;
  pageViewCount: number;
  greeted: boolean;
  tipped: boolean;
  nudged: boolean;
  quiet: boolean;
  hidden: boolean;
};

export const SESSION_CAP = 3;
export const PAGE_VIEW_CAP = 1;

export const emptyBudget: Budget = { sessionCount: 0, pageViewCount: 0, greeted: false, tipped: false, nudged: false, quiet: false, hidden: false };

export type Blockers = { menuOpen: boolean; lightboxOpen: boolean; formActive: boolean; panelOpen: boolean };

export function isFormPath(pathname: string): boolean {
  return pathname === "/contact" || pathname.startsWith("/contact/");
}

export function canSpeak(b: Budget, kind: UnpromptedKind, pathname: string, blockers: Blockers): boolean {
  if (b.hidden || b.quiet) return false;
  if (isFormPath(pathname)) return false;
  if (blockers.menuOpen || blockers.lightboxOpen || blockers.formActive || blockers.panelOpen) return false;
  if (b.sessionCount >= SESSION_CAP || b.pageViewCount >= PAGE_VIEW_CAP) return false;
  if (kind === "greeting" && b.greeted) return false;
  if (kind === "tip" && b.tipped) return false;
  if (kind === "nudge" && b.nudged) return false;
  return true;
}

export function spend(b: Budget, kind: UnpromptedKind): Budget {
  return {
    ...b,
    sessionCount: b.sessionCount + 1,
    pageViewCount: b.pageViewCount + 1,
    greeted: b.greeted || kind === "greeting",
    tipped: b.tipped || kind === "tip",
    nudged: b.nudged || kind === "nudge",
  };
}

/** A new page view resets only the per-page counter. */
export const newPageView = (b: Budget): Budget => ({ ...b, pageViewCount: 0 });
