// Clean: airy and light. Lots of white space, a thin accent bar, soft circles, left-aligned type.
import type { ThemeDef } from '../core';

export const clean: ThemeDef = {
  id: 'clean',
  name: 'Clean',
  blurb: 'Light, airy, plenty of white space.',
  fonts: { headline: 'sans', body: 'sans' },
  schemes: { light: 'light', dark: 'dark' },
  style: { headWeight: 700, bodyWeight: 400, upper: false, headScale: 1, lineHeight: 1.12, radius: 28, cta: 'pill', offer: 'plain', bullet: 'dot' },
  neighbours: ['fresh', 'minimal_dark'],
  recipes: [
    { id: 'clean-open', name: 'Open page', arch: 'plain', align: 'left', deco: ['accentBar', 'softCircle'] },
    { id: 'clean-card', name: 'Soft card', arch: 'card', align: 'left', panel: 'surface', deco: ['softCircle', 'dotGrid'] },
    { id: 'clean-band', name: 'Colour block', arch: 'band', align: 'left', edge: 'straight', panel: 'solid', deco: ['softCircle'] },
    { id: 'clean-photo-split', name: 'Photo and page', arch: 'photoSplit', align: 'left', edge: 'straight', panel: 'bg', deco: [] },
    { id: 'clean-photo-card', name: 'Photo with card', arch: 'photoCard', align: 'left', panel: 'surface', deco: [] },
  ],
};
