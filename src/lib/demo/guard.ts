import { getCurrentUser } from "@/lib/auth";
import { isDemoUser } from "./index";

/**
 * For the public emailed-link routes (/p/..., /account/delete), which have no signed-in user of their own: true when the
 * browser also holds a demo session. A second guard only; the first is that the demo cannot send these links at all.
 * A lookup that fails counts as "not demo" so a database blip does not lock a real owner out of a link.
 */
export async function currentSessionIsDemo(): Promise<boolean> {
  try {
    return isDemoUser(await getCurrentUser());
  } catch {
    return false;
  }
}
