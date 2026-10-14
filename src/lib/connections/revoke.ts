// Best-effort revocation on Meta's side when the owner disconnects. Failures are ignored by the caller.
//
// Facebook: DELETE /me/permissions drops the app's permissions for the token's user. With a Page access token Meta
// may refuse (it wants a user token); then the owner's access ends here anyway because we delete the token, and
// they can remove the app in Facebook's "Business integrations" settings.
// Instagram Login has no revoke call: the owner removes the app under Instagram > Settings > Apps and websites.

import type { Provider } from "@/lib/queue/types";
import { graphVersion } from "./config";
import { graphRequest, type FetchLike } from "./graph";

export async function revokeAtMeta(args: { provider: Provider; token: string; fetch?: FetchLike }): Promise<void> {
  if (args.provider !== "facebook") return;
  await graphRequest({
    method: "DELETE",
    url: `https://graph.facebook.com/${graphVersion()}/me/permissions`,
    token: args.token,
    fetch: args.fetch,
    timeoutMs: 8_000,
  });
}
