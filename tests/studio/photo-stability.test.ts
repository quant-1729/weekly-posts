// The owner's photo must not flicker in the studio: the <image> element keeps its place (same key chain) and its href
// when something unrelated changes (moving or typing in a text layer, a shadow or border coming and going on the photo),
// and rebuilt option thumbnails update in place.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { toReact } from '@/components/studio/scene-view';
import { getServerShaper } from '@/lib/studio/server';
import { buildScene } from '@/lib/studio/scene';
import { buildOptions } from '@/lib/studio/templates';
import type { ImageLayer, StudioDoc, StudioInput, TextLayer } from '@/lib/studio/types';

const PHOTO = '/api/files/photos/b1/cake.jpg';
const input = (): StudioInput => ({
  format: 'square',
  content: { brandName: 'Sweet Crumbs', headline: "Monday's special", subline: '', offer: '20% OFF', offerNote: 'On all cakes', cta: 'Order on WhatsApp', contacts: [], qr: null, language: 'en' },
  brand: { colors: { primary: '#1F4E9C', secondary: '#F5A623', accent: '#F5A623', background: '#FFFFFF' }, fonts: { headline: 'sans', body: 'sans' }, logo: null, character: null },
  photo: { id: 'p1', src: PHOTO, w: 1200, h: 900 },
});

interface Found { path: string; href: unknown; ids: string[] }

/** Every <image> in the React tree: its chain of keys and its href, plus the ids the picture's clip and filter use. */
function images(node: ReactNode, path: string[] = [], out: Found[] = []): Found[] {
  if (Array.isArray(node)) {
    node.forEach((c) => images(c, path, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  const here = [...path, `${String(el.type)}#${String(el.key)}`];
  if (el.type === 'image') out.push({ path: here.join('>'), href: el.props.href, ids: [] });
  images(el.props.children as ReactNode, here, out);
  return out;
}
function attrs(node: ReactNode, name: string, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((c) => attrs(c, name, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  const p = (node as ReactElement<Record<string, unknown>>).props;
  if (typeof p[name] === 'string') out.push(p[name] as string);
  attrs(p.children as ReactNode, name, out);
  return out;
}

const draw = (doc: StudioDoc, shaper: Awaited<ReturnType<typeof getServerShaper>>, positional = false, skip?: Set<string>) => {
  const tree = buildScene(doc, shaper, { idPrefix: 'cv', skip });
  return (tree.c ?? []).map((c, i) => toReact(c, i, positional));
};

describe('photo stays put while the poster is redrawn', () => {
  it('keeps the photo element, href, clip and filter ids when a text layer moves, is typed in, or is hidden for editing', async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(input(), shaper).find((o) => o.doc.layers.some((l) => l.kind === 'image' && l.role === 'photo'))!.doc;
    const before = draw(doc, shaper);
    const text = doc.layers.find((l): l is TextLayer => l.kind === 'text')!;
    const moved: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l.id === text.id ? { ...l, x: l.x + 40, y: l.y + 25, text: text.text + '!' } as TextLayer : l)) };
    const after = draw(moved, shaper);
    const editing = draw(moved, shaper, false, new Set([text.id]));
    const b = images(before);
    expect(b.length).toBeGreaterThan(0);
    expect(b[0].href).toBe(PHOTO);
    for (const next of [after, editing]) {
      expect(images(next)).toEqual(b);
      expect(attrs(next, 'clipPath').filter((v) => v.startsWith('url('))).toEqual(attrs(before, 'clipPath').filter((v) => v.startsWith('url(')));
    }
    expect(attrs(after, 'filter')).toEqual(attrs(before, 'filter'));
  });

  it('keeps the photo element in place when its shadow or border is switched on', async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(input(), shaper).find((o) => o.doc.layers.some((l) => l.kind === 'image' && l.role === 'photo'))!.doc;
    const photo = doc.layers.find((l): l is ImageLayer => l.kind === 'image' && l.role === 'photo')!;
    const framed: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l.id === photo.id ? ({ ...l, mask: 'rounded', radius: 40, shadow: { color: '#000000', alpha: 0.25, blur: 40, dx: 0, dy: 16 }, border: { color: '#FFFFFF', width: 12 } } as ImageLayer) : l)) };
    const plain: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l.id === photo.id ? ({ ...l, mask: 'rounded', radius: 40, shadow: undefined, border: undefined } as ImageLayer) : l)) };
    expect(images(draw(framed, shaper))).toEqual(images(draw(plain, shaper)));
  });

  it('rebuilt option thumbnails (new layer ids every time) update in place when matched by position', async () => {
    const shaper = await getServerShaper();
    const a = buildOptions(input(), shaper)[0].doc;
    const b = buildOptions(input(), shaper)[0].doc;
    expect(a.layers[0].id).not.toBe(b.layers[0].id);
    expect(images(draw(a, shaper, true))).toEqual(images(draw(b, shaper, true)));
    // By id they would be new elements (what made the thumbnails blink).
    expect(images(draw(a, shaper, false))).not.toEqual(images(draw(b, shaper, false)));
  });
});
