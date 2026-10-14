/** The off switch: `"enabled": false` in src/content/tween.json, or the environment variable TWEEN_ENABLED=0 (also false, off). */
export function tweenEnabled(content: { enabled: boolean }, env: Record<string, string | undefined> = process.env): boolean {
  const v = env.TWEEN_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return content.enabled;
}
