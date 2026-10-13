/** Logo path helpers with no server dependencies, so client components can use them. */

/** File types the logo picker offers. SVG is not accepted. */
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

/** Where the logo lives: `brand-assets/{brand_id}/logo.png`. This string is what brand_memory.logo_path holds. */
export function logoStoragePath(brandId: string): string {
  return `brand-assets/${brandId}/logo.png`;
}

/** URL the browser uses to show a stored logo (served by /api/files after a membership check). */
export function logoUrl(logoPath: string | null | undefined, version?: string | number): string | null {
  if (!logoPath) return null;
  return `/api/files/${logoPath}${version ? `?v=${encodeURIComponent(String(version))}` : ""}`;
}
