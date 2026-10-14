// Bold sale: big display type, diagonal bands and corner triangles, ribbon offer tag. High energy.
import type { ThemeDef } from '../core';

export const bold_sale: ThemeDef = {
  id: 'bold_sale',
  name: 'Bold sale',
  blurb: 'Big numbers, diagonal bands, high energy.',
  fonts: { headline: 'display', body: 'condensed' },
  schemes: { light: 'primary', dark: 'dark' },
  style: { headWeight: 800, bodyWeight: 700, upper: true, headScale: 1.12, lineHeight: 1.04, radius: 10, cta: 'rect', offer: 'ribbon', bullet: 'diamond' },
  neighbours: ['playful', 'festive'],
  recipes: [
    { id: 'sale-band', name: 'Diagonal band', arch: 'band', align: 'left', edge: 'diag', panel: 'solid', deco: ['diagStripes'] },
    { id: 'sale-burst', name: 'Stripes and type', arch: 'plain', align: 'center', deco: ['diagStripes', 'dotGrid'] },
    { id: 'sale-card', name: 'Poster card', arch: 'card', align: 'left', panel: 'surface', border: 'thick', deco: ['diagStripes'] },
    { id: 'sale-photo-diag', name: 'Photo with diagonal band', arch: 'photoSplit', align: 'left', edge: 'diag', panel: 'solid', deco: [] },
    { id: 'sale-photo-full', name: 'Photo poster', arch: 'photoFull', align: 'left', deco: [] },
  ],
};
