// Design engine (PRD v3 G-1 to G-7, changes C-14, C-15, C-20). Pure code, no AI calls.
//
//   renderDesign(input)            one design (theme x layout x format) as a PNG with a report
//   designOptions(...)             three visibly different options for the same content
//   listLayouts(theme, format)     the layout families of a theme
//   splitIntoSlides / renderCarousel   one USP per slide
//   textLogoSvg / textLogoPng      the business name as a logo, in the kit's headline font
//
// Contract types live in ./types (orchestrator-owned).

import { renderDesignDetailed } from './engine';
import type { DesignInput, DesignResult } from './types';

export * from './types';
export * from './filter-presets';
export { applyPostFilter, lookAt } from './filters';
export { renderDesignDetailed, safeZoneIssues, candidateRecipes } from './engine';
export type { DesignDetail } from './engine';
export { designOptions, listLayouts } from './options';
export type { LayoutInfo } from './options';
export { needsCarousel, renderCarousel, renderSlideSet, slideContents, slideRoleCandidates, splitIntoSlides } from './carousel';
export { textLogoPng, textLogoSvg } from './text-logo';
export type { TextLogoOptions } from './text-logo';
export { THEMES, THEME_LIST, getTheme } from './themes';
export { CONTENT_BOX, SAFE_ZONES, TYPE_SCALE } from './core';
export { buildPalette, SCHEMES } from './palette';
export type { Palette, Scheme } from './palette';
export type { Placed } from './scene';

/** Render one design. `input.scheme` (optional) applies a DesignOption's colour scheme. */
export async function renderDesign(input: DesignInput): Promise<DesignResult> {
  const r = await renderDesignDetailed(input);
  return { png: r.png, svg: r.svg, width: r.width, height: r.height, themeId: r.themeId, layoutId: r.layoutId, report: r.report };
}
