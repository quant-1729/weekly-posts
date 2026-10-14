// Playful: rounded type, blobs, confetti, pill shapes and a wavy panel.
import type { ThemeDef } from '../core';

export const playful: ThemeDef = {
  id: 'playful',
  name: 'Playful',
  blurb: 'Rounded type, blobs and confetti.',
  fonts: { headline: 'rounded', body: 'rounded' },
  schemes: { light: 'primary', dark: 'dark' },
  style: { headWeight: 800, bodyWeight: 700, upper: false, headScale: 1.05, lineHeight: 1.1, radius: 56, cta: 'pill', offer: 'tag', bullet: 'spark' },
  neighbours: ['fresh', 'festive'],
  recipes: [
    { id: 'playful-blobs', name: 'Blobs', arch: 'plain', align: 'left', deco: ['blobs', 'confetti'] },
    { id: 'playful-card', name: 'Bubble card', arch: 'card', align: 'center', panel: 'surface', deco: ['blobs', 'confetti'] },
    { id: 'playful-wave', name: 'Wave', arch: 'band', align: 'left', edge: 'wave', panel: 'surface', deco: ['confetti'] },
    { id: 'playful-photo-wave', name: 'Photo with wave', arch: 'photoSplit', align: 'left', edge: 'wave', panel: 'surface', deco: [] },
    { id: 'playful-photo-card', name: 'Photo with bubble card', arch: 'photoCard', align: 'center', panel: 'surface', deco: [] },
  ],
};
