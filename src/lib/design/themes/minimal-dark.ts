// Minimal dark: near-black ground, a soft glow, quiet type and one accent.
import type { ThemeDef } from '../core';

export const minimal_dark: ThemeDef = {
  id: 'minimal_dark',
  name: 'Minimal dark',
  blurb: 'Dark, quiet, one accent colour.',
  fonts: { headline: 'sans', body: 'sans' },
  schemes: { light: 'dark', dark: 'dark' },
  style: { headWeight: 700, bodyWeight: 400, upper: false, headScale: 0.92, lineHeight: 1.1, radius: 14, cta: 'rect', offer: 'plain', bullet: 'dash' },
  neighbours: ['premium', 'clean'],
  recipes: [
    { id: 'dark-left', name: 'Left aligned', arch: 'plain', align: 'left', deco: ['darkGlow', 'accentBar'] },
    { id: 'dark-card', name: 'Raised card', arch: 'card', align: 'left', panel: 'surface', deco: ['darkGlow'] },
    { id: 'dark-band', name: 'Lower panel', arch: 'band', align: 'left', edge: 'straight', panel: 'surface', deco: ['darkGlow'] },
    { id: 'dark-photo-full', name: 'Photo and shade', arch: 'photoFull', align: 'left', deco: [] },
    { id: 'dark-photo-split', name: 'Photo and panel', arch: 'photoSplit', align: 'left', edge: 'straight', panel: 'bg', deco: [] },
  ],
};
