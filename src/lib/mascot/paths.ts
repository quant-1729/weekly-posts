// Where a mascot's files live. No server imports, so client components can use it.
// Files are in the `mascots` bucket under `{brand_id}/{mascot_id}/`; the strings
// below include the bucket (like brand_memory.logo_path) and work with /api/files/.

import { MASCOT_POSES, type MascotPose } from '@/lib/ai/prompts/mascot';

/** Path inside the `mascots` bucket. */
export const poseSvgPath = (brandId: string, mascotId: string, pose: MascotPose) => `${brandId}/${mascotId}/pose-${pose}.svg`;
export const posePngPath = (brandId: string, mascotId: string, pose: MascotPose) => `${brandId}/${mascotId}/pose-${pose}.png`;
export const sheetPngPath = (brandId: string, mascotId: string) => `${brandId}/${mascotId}/sheet.png`;

/** Value stored in mascots.sheet_path: includes the bucket name. */
export const sheetStoredPath = (brandId: string, mascotId: string) => `mascots/${sheetPngPath(brandId, mascotId)}`;

/** URL the browser uses (served by /api/files after a membership check). */
export const fileUrl = (storedPath: string) => `/api/files/${storedPath}`;

export interface DownloadFile {
  name: string;
  url: string;
}

/** Everything the owner can download: the sheet, and one PNG and one SVG per pose (17 files). */
export function mascotDownloads(brandId: string, mascotId: string, mascotName: string): DownloadFile[] {
  const base = mascotName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mascot';
  return [
    { name: `${base}-sheet.png`, url: fileUrl(`mascots/${sheetPngPath(brandId, mascotId)}`) },
    ...MASCOT_POSES.map((pose) => ({ name: `${base}-${pose}.png`, url: fileUrl(`mascots/${posePngPath(brandId, mascotId, pose)}`) })),
    ...MASCOT_POSES.map((pose) => ({ name: `${base}-${pose}.svg`, url: fileUrl(`mascots/${poseSvgPath(brandId, mascotId, pose)}`) })),
  ];
}
