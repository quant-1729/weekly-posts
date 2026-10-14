/** The site-wide off switch: `enabled: false` in content/mascot.json, or TWEEN_ENABLED=0 in the environment at build time. */
export function mascotEnabled(content: { enabled: boolean }, env: Record<string, string | undefined> = process.env): boolean {
  if (env.TWEEN_ENABLED === "0" || env.TWEEN_ENABLED === "false" || env.TWEEN_ENABLED === "off") return false;
  return content.enabled;
}
