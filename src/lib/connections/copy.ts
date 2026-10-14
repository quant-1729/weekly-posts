// Words of the emails about connections. Short, plain English, no jargon (the screen words are in strings.ts).

import { APP_NAME } from "@/lib/app";
import type { Provider } from "@/lib/queue/types";

export const PROVIDER_LABEL: Record<Provider, string> = { instagram: "Instagram", facebook: "Facebook Page" };

export const connectionCopy = {
  email: {
    subject: (provider: Provider) => `Reconnect your ${PROVIDER_LABEL[provider]} to keep your posts going`,
    intro: (provider: Provider, account: string) =>
      `${APP_NAME} can no longer post to your ${PROVIDER_LABEL[provider]}${account ? ` (${account})` : ""}. The permission you gave us has ended, so we have stopped posting there. Nothing was posted without your approval, and your approved posts are still safe.`,
    next: "It takes about a minute: open the link, press Reconnect and allow us to post again. Until then we will email you each post so you can share it yourself.",
    button: "Reconnect",
    linkFallback: "If the button does not work, copy this link into your browser:",
  },
} as const;
