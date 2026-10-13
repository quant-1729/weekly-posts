import { registerApprovalLinkHandlers } from "@/lib/approvals/link-handlers";
import { registerBuiltinLinkHandlers } from "./builtin";

/**
 * Registers every link handler. The /e/[token] route and the dispatcher call this. A task that adds
 * handlers imports its registration here (a later registration replaces an earlier one).
 */
let loaded = false;
export function loadLinkHandlers(): void {
  if (loaded) return;
  loaded = true;
  registerBuiltinLinkHandlers();
  registerApprovalLinkHandlers(); // V-16: approve, skip, edit, ready
}
