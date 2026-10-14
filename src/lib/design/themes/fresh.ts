// Fresh: organic leaf shapes, rounded type, a wavy panel. Light and green-friendly.
import type { ThemeDef } from '../core';

export const fresh: ThemeDef = {
  id: 'fresh',
  name: 'Fresh',
  blurb: 'Leaves and soft curves for food, wellness and nature.',
  fonts: { headline: 'rounded', body: 'sans' },
  schemes: { light: 'light', dark: 'dark' },
  style: { headWeight: 800, bodyWeight: 500, upper: false, headScale: 1, lineHeight: 1.12, radius: 40, cta: 'pill', offer: 'tag', bullet: 'leaf' },
  neighbours: ['clean', 'playful'],
  recipes: [
    { id: 'fresh-leaf', name: 'Leaves', arch: 'plain', align: 'left', deco: ['leaves', 'accentBar'] },
    { id: 'fresh-card', name: 'Leaf card', arch: 'card', align: 'left', panel: 'surface', deco: ['leaves'] },
    { id: 'fresh-wave', name: 'Wave', arch: 'band', align: 'left', edge: 'wave', panel: 'solid', deco: ['leaves'] },
    { id: 'fresh-photo-wave', name: 'Photo with wave', arch: 'photoSplit', align: 'left', edge: 'wave', panel: 'solid', deco: [] },
    { id: 'fresh-photo-card', name: 'Photo with leaf card', arch: 'photoCard', align: 'left', panel: 'surface', deco: [] },
  ],
};
