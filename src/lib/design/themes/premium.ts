// Premium: serif headline, thin rules and frames, dark (or cream) ground, centred and quiet.
import type { ThemeDef } from '../core';

export const premium: ThemeDef = {
  id: 'premium',
  name: 'Premium',
  blurb: 'Serif type, thin rules, dark or cream.',
  fonts: { headline: 'serif', body: 'sans' },
  schemes: { light: 'dark', dark: 'dark' },
  style: { headWeight: 700, bodyWeight: 400, upper: false, headScale: 0.95, lineHeight: 1.14, radius: 4, cta: 'rect', offer: 'plain', bullet: 'dash' },
  neighbours: ['minimal_dark', 'local'],
  recipes: [
    { id: 'premium-frame', name: 'Framed', arch: 'plain', align: 'center', deco: ['thinFrame', 'rules'] },
    { id: 'premium-card', name: 'Gilt card', arch: 'card', align: 'center', panel: 'surface', border: 'double', deco: ['thinFrame'] },
    { id: 'premium-left', name: 'Editorial', arch: 'plain', align: 'left', deco: ['rules', 'darkGlow'] },
    { id: 'premium-photo-split', name: 'Photo and panel', arch: 'photoSplit', align: 'center', edge: 'straight', panel: 'bg', deco: ['rules'] },
    { id: 'premium-photo-card', name: 'Photo with gilt card', arch: 'photoCard', align: 'center', panel: 'surface', border: 'double', deco: [] },
  ],
};
