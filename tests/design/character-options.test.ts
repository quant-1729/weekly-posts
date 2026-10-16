// CH-2: the three options of a brief are three genuinely different compositions, chosen from the post type, the photo, the offer line and
// a per-brand seed; the same brand and brief always get the same options.
import { describe, expect, it } from 'vitest';
import type { PostType } from '@/lib/briefs/types';
import { rolesFor } from '@/lib/design/character';
import { archOf, designOptions, hashSeed, primaryRole } from '@/lib/design/options';
import { DEFAULT_KIT, THEME_IDS, type DesignFormat, type DesignOption } from '@/lib/design';
import { content, kit, PALETTES } from './fixtures';

const BAKERY = kit(PALETTES.bakery);

interface Brief {
  name: string;
  postType: PostType;
  hasPhoto: boolean;
  offer: boolean;
  scan?: boolean;
}
/** Offer with a photo, a new product without one, and a festival greeting. */
const BRIEFS: Brief[] = [
  { name: 'offer with photo', postType: 'offer', hasPhoto: true, offer: true },
  { name: 'new product, no photo', postType: 'new_product', hasPhoto: false, offer: false },
  { name: 'festival greeting', postType: 'occasion', hasPhoto: false, offer: false },
];
const contentFor = (b: Brief) => content({ offerLine: b.offer ? 'Till Sun 20 Oct' : null, qr: b.scan ? { text: 'https://x.example/r/1', label: 'Scan to visit' } : null, cta: b.scan ? { kind: 'scan', text: 'Scan to order' } : { kind: 'order', text: 'Order on WhatsApp' } });

const optionsOf = (b: Brief, brandId: string, character: 'rig' | 'image' | null = 'rig', format: DesignFormat = 'square', themeKit = BAKERY): DesignOption[] =>
  designOptions({ kit: themeKit, content: contentFor(b), format, hasPhoto: b.hasPhoto, seed: hashSeed(brandId), postType: b.postType, character });
const composition = (o: DesignOption) => `${archOf(o.themeId, o.layoutId)}|${o.role ?? 'none'}`;

describe('three options, three compositions', () => {
  it('every option of a brief has a different layout family or role, and the roles differ', () => {
    for (const b of BRIEFS) {
      for (const brand of ['brand-1', 'brand-2', 'brand-3', 'brand-4', 'brand-5', 'brand-6']) {
        const o = optionsOf(b, brand);
        expect(o, `${b.name} ${brand}`).toHaveLength(3);
        expect(new Set(o.map(composition)).size, `${b.name} ${brand}: ${o.map(composition).join(' / ')}`).toBe(3);
        const roles = o.map((x) => x.role).filter((r) => r != null);
        expect(new Set(roles).size, `${b.name} ${brand}: roles ${roles.join(',')}`).toBe(roles.length);
        // Different layout families, as far as the themes have them.
        expect(new Set(o.map((x) => archOf(x.themeId, x.layoutId))).size, `${b.name} ${brand}: families`).toBeGreaterThanOrEqual(2);
        // Every option names a role (a face is on); at most one is typographic.
        expect(o.filter((x) => x.role === undefined)).toEqual([]);
        expect(o.filter((x) => x.role === null).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('chooses the role from the post: an offer holds a sign, a festival celebrates, a new product with a photo is presented', () => {
    const roleOfMain = (b: Brief) => primaryRole(contentFor(b), { postType: b.postType }, b.hasPhoto);
    expect(roleOfMain(BRIEFS[0])).toBe('sign_holder');
    expect(roleOfMain(BRIEFS[2])).toBe('celebrator');
    expect(roleOfMain({ ...BRIEFS[1], hasPhoto: true })).toBe('presenter');
    expect(roleOfMain({ name: 'timings', postType: 'announcement', hasPhoto: false, offer: false })).toBe('pointer');
    expect(roleOfMain({ name: 'scan', postType: 'brand', hasPhoto: false, offer: true, scan: true })).toBe('pointer');
    expect(primaryRole(content({ offerLine: null, blocks: [{ kind: 'phone', text: '+91 98200 12345' }] }), { postType: 'brand' }, false)).toBe('narrator');
    // Hours on the card: the character perches on it.
    expect(roleOfMain({ name: 'hours', postType: 'brand', hasPhoto: false, offer: false })).toBe('percher');
    // The main role is in the set whenever the layout can carry it.
    for (const brand of ['a', 'b', 'c', 'd']) {
      expect(optionsOf(BRIEFS[0], brand).map((o) => o.role)).toContain('sign_holder');
      expect(optionsOf(BRIEFS[2], brand).map((o) => o.role)).toContain('celebrator');
    }
  });

  it('the quiet option leads with the photo or the type: its character is an accent (peeker or percher) where the layout has a panel edge', () => {
    for (const brand of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const first = optionsOf(BRIEFS[0], brand)[0];
      expect(['peeker', 'percher', 'pointer', 'presenter']).toContain(first.role);
    }
  });

  it('two brands with identical briefs get different option sets; one brand always gets the same', () => {
    for (const b of BRIEFS) {
      const sets = new Set<string>();
      for (let i = 0; i < 24; i++) sets.add(JSON.stringify(optionsOf(b, `brand-${i}`)));
      expect(sets.size, b.name).toBeGreaterThanOrEqual(4);
      expect(optionsOf(b, 'brand-9')).toEqual(optionsOf(b, 'brand-9'));
    }
    expect(JSON.stringify(optionsOf(BRIEFS[0], 'bakery-one'))).not.toBe(JSON.stringify(optionsOf(BRIEFS[0], 'bakery-two')));
  });

  it('without a character the options still differ in family and carry no role', () => {
    for (const b of BRIEFS) {
      for (const brand of ['a', 'b', 'c', 'd']) {
        const o = optionsOf(b, brand, null);
        expect(o).toHaveLength(3);
        expect(o.every((x) => x.role === undefined)).toBe(true);
        expect(new Set(o.map((x) => archOf(x.themeId, x.layoutId))).size).toBeGreaterThanOrEqual(2);
        expect(new Set(o.map((x) => `${x.themeId}|${x.layoutId}|${x.scheme}`)).size).toBe(3);
      }
    }
  });

  it('works for every theme and size, with roles each size can carry; pose-image faces get presenter, pointer, narrator or celebrator only', () => {
    for (const themeId of THEME_IDS) {
      for (const format of ['square', 'portrait', 'vertical', 'landscape', 'thumbnail', 'banner'] as const) {
        for (const b of BRIEFS) {
          const k = { ...DEFAULT_KIT, colors: PALETTES.navy, themeId };
          const o = optionsOf(b, 'brand-x', 'rig', format, k);
          expect(o.length, `${themeId} ${format} ${b.name}`).toBeGreaterThanOrEqual(1);
          const can = rolesFor('rig', format);
          for (const x of o) if (x.role) expect(can).toContain(x.role);
          const img = optionsOf(b, 'brand-x', 'image', format, k);
          for (const x of img) if (x.role) expect(['presenter', 'pointer', 'narrator', 'celebrator']).toContain(x.role);
        }
      }
    }
  });
});
