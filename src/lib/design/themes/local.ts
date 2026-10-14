// Local / traditional: a patterned border (diamonds and dots) drawn by code, serif headline, warm ground.
import type { ThemeDef } from '../core';

export const local: ThemeDef = {
  id: 'local',
  name: 'Local',
  blurb: 'Patterned border and warm, traditional type.',
  fonts: { headline: 'serif', body: 'sans' },
  schemes: { light: 'light', dark: 'dark' },
  style: { headWeight: 800, bodyWeight: 500, upper: false, headScale: 1, lineHeight: 1.14, radius: 8, cta: 'rect', offer: 'tag', bullet: 'diamond' },
  neighbours: ['festive', 'premium'],
  recipes: [
    { id: 'local-border', name: 'Patterned border', arch: 'plain', align: 'center', deco: ['localBorder'] },
    { id: 'local-card', name: 'Bordered card', arch: 'card', align: 'center', panel: 'surface', border: 'double', deco: ['localBorder'] },
    { id: 'local-band', name: 'Colour block', arch: 'band', align: 'left', edge: 'straight', panel: 'solid', deco: ['localBorder'] },
    { id: 'local-photo-split', name: 'Photo with border', arch: 'photoSplit', align: 'center', edge: 'straight', panel: 'bg', deco: ['localBorder'] },
    { id: 'local-photo-card', name: 'Photo with card', arch: 'photoCard', align: 'center', panel: 'surface', border: 'double', deco: ['localBorder'] },
  ],
};
