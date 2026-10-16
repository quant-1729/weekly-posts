// Small SVG previews of the brand characters for the Brand Face card (CH-3), drawn by the character rig in the brand's
// colours and cached per colours. Server only (the card receives the markup as text). When the rig cannot draw a
// character (not built yet, or a bug), the preview falls back to Tween's own drawing so the card never breaks.

import { CHARACTER_IDS, CHARACTER_LABELS, type CharacterAction, type CharacterColors, type CharacterId } from '@/lib/characters/types';
import { drawCharacter } from '@/lib/characters';
import { tweenColorsFor, type BrandColorsInput, type TweenColors } from '@/lib/mascot/colors';
import { renderTween, type TweenPose } from '@/lib/mascot/tween';

/** The poses shown under the gallery, so the owner sees how the character acts. */
export const PREVIEW_POSES = ['wave', 'present', 'hold-sign', 'celebrate'] as const satisfies readonly CharacterAction[];
export type PreviewPose = (typeof PREVIEW_POSES)[number];

/** Tween's drawing nearest each action (Tween has no placard pose; the fallback only needs to look right). */
const TWEEN_FALLBACK: Record<PreviewPose, TweenPose> = { wave: 'wave', present: 'present', 'hold-sign': 'reach', celebrate: 'celebrate' };

export interface CharacterPreview {
  id: CharacterId;
  /** What the owner sees: the object, never the working name. */
  label: string;
  /** <svg> markup, drawn without any text. */
  svg: string;
  /** True when the rig could not draw it and Tween stands in. */
  fallback: boolean;
}

/** The colours the rig recolours: the same brand-derived colours Tween's scarf and accent use. */
export function characterColorsFor(tween: TweenColors): CharacterColors {
  return { accent: tween.scarf, accentDark: tween.scarfDark };
}

export function characterColorsForBrand(brand: BrandColorsInput | null | undefined): CharacterColors {
  return characterColorsFor(tweenColorsFor(brand));
}

const CACHE_MAX = 400;
const cache = new Map<string, string>();

function remember(key: string, svg: string): string {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, svg);
  return svg;
}

/** Test hook: forget the cached drawings. */
export function clearCharacterPreviewCache(): void {
  cache.clear();
}

/** One character in one action as an <svg>, cached per colours; Tween's own drawing when the rig throws. */
export function previewSvg(id: CharacterId, action: PreviewPose, colors: CharacterColors, tween?: TweenColors): { svg: string; fallback: boolean } {
  const key = `${id}|${action}|${colors.accent}|${colors.accentDark}|${colors.body ?? ''}`;
  const hit = cache.get(key);
  if (hit) return { svg: hit, fallback: false };
  try {
    const d = drawCharacter(id, action, colors);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 0 260 260" width="160" height="160" role="img" aria-hidden="true">${d.body}</svg>`;
    return { svg: remember(key, svg), fallback: false };
  } catch {
    // Not cached: once the rig can draw it, the next load shows the real character.
    const stand = renderTween({ pose: TWEEN_FALLBACK[action], colors: tween, size: 160 })
      .replace(/<title>.*?<\/title>/, '')
      .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"');
    return { svg: stand, fallback: true };
  }
}

/** The gallery: every offered character waving, Tween first, labelled by its object. */
export function characterGallery(tween: TweenColors): CharacterPreview[] {
  const colors = characterColorsFor(tween);
  return CHARACTER_IDS.map((id) => {
    const p = previewSvg(id, 'wave', colors, tween);
    return { id, label: CHARACTER_LABELS[id], svg: p.svg, fallback: p.fallback };
  });
}

/** The poses row for the selected character. */
export function characterPoses(id: CharacterId, tween: TweenColors): { action: PreviewPose; svg: string }[] {
  const colors = characterColorsFor(tween);
  return PREVIEW_POSES.map((action) => ({ action, svg: previewSvg(id, action, colors, tween).svg }));
}
