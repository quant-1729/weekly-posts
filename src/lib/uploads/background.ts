import { after } from "next/server";
import { refreshVoice } from "./voice";

/**
 * Runs the debounced voice refresh after the response is sent, so the owner never waits for it.
 * Outside a request (scripts, tests) it simply starts the work. Never throws.
 */
export function scheduleVoiceRefresh(userId: string, brandId: string): void {
  const work = () =>
    refreshVoice({ userId, brandId }).then(
      () => undefined,
      (e) => console.error("[uploads] voice refresh", e),
    );
  try {
    after(work);
  } catch {
    void work();
  }
}
