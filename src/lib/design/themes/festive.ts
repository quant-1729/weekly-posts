// Festive: serif headline, sparkles and an ornate double border drawn by code. No AI art.
import type { ThemeDef } from '../core';

export const festive: ThemeDef = {
  id: 'festive',
  name: 'Festive',
  blurb: 'Sparkles and ornate borders for festivals and celebrations.',
  fonts: { headline: 'serif', body: 'rounded' },
  schemes: { light: 'primary', dark: 'dark' },
  style: { headWeight: 700, bodyWeight: 500, upper: false, headScale: 1, lineHeight: 1.14, radius: 24, cta: 'pill', offer: 'ribbon', bullet: 'spark' },
  neighbours: ['local', 'playful'],
  recipes: [
    { id: 'festive-border', name: 'Border and sparkles', arch: 'plain', align: 'center', deco: ['festiveBorder', 'sparkles'] },
    { id: 'festive-card', name: 'Gilt card', arch: 'card', align: 'center', panel: 'surface', border: 'double', deco: ['festiveBorder', 'sparkles'] },
    { id: 'festive-arch', name: 'Arch', arch: 'band', align: 'center', edge: 'arch', panel: 'solid', deco: ['festiveBorder', 'sparkles'] },
    { id: 'festive-photo-arch', name: 'Photo with arch', arch: 'photoSplit', align: 'center', edge: 'arch', panel: 'solid', deco: ['festiveBorder'] },
    { id: 'festive-photo-card', name: 'Photo with gilt card', arch: 'photoCard', align: 'center', panel: 'surface', border: 'double', deco: ['festiveBorder'] },
  ],
};
