// Classic: the v2 look (colour field, circles, light card, photo with colour band), kept as a theme
// so existing brands do not change (9-changes-v3.md section 14). For square, vertical and landscape
// the renderer delegates to the v2 templates when the content is plain enough (see ../classic.ts);
// these recipes carry the same look to every format and to richer content.
import type { ThemeDef } from '../core';

export const classic: ThemeDef = {
  id: 'classic',
  name: 'Classic',
  blurb: 'Colour field with soft circles, light card, photo with a colour band.',
  fonts: { headline: 'sans', body: 'sans' },
  schemes: { light: 'primary', dark: 'dark' },
  style: { headWeight: 800, bodyWeight: 500, upper: false, headScale: 1, lineHeight: 1.18, radius: 36, cta: 'pill', offer: 'tag', bullet: 'dot' },
  neighbours: ['clean', 'bold_sale'],
  recipes: [
    { id: 'classic-text', name: 'Colour and text', arch: 'plain', align: 'center', deco: ['circles'] },
    { id: 'classic-card', name: 'Light card on colour', arch: 'card', align: 'left', panel: 'surface', deco: ['circles'] },
    { id: 'classic-band', name: 'Colour block', arch: 'band', align: 'left', edge: 'straight', panel: 'surface', deco: ['circles'] },
    { id: 'classic-photo-band', name: 'Photo with colour band', arch: 'photoSplit', align: 'left', edge: 'straight', panel: 'bg', deco: [] },
    { id: 'classic-photo-full', name: 'Full photo with caption', arch: 'photoFull', align: 'left', deco: [] },
  ],
};
