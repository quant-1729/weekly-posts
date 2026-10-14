import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock('@/app/(app)/brand/actions', () => ({ setMascotInPostsAction: vi.fn() }));
vi.mock('@/app/(app)/mascot/actions', () => ({ saveMascotAction: vi.fn() }));

import { MascotScreen } from '@/app/(app)/mascot/mascot-screen';
import TermsPage from '@/app/terms/page';
import { MascotCard } from '@/components/brand/mascot-card';
import { MascotControls } from '@/components/week/mascot-controls';
import { fill, s } from '@/lib/i18n/strings';
import { mascotDownloads } from '@/lib/mascot/paths';
import { TWEEN_POST_POSES } from '@/lib/mascot/poses';
import type { MascotView } from '@/lib/mascot/service';
import type { WeekPostView } from '@/lib/weekly/view';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

const view = (over: Partial<MascotView> = {}): MascotView => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Tween',
  scarf: null,
  sheet_path: 'mascots/b/m/sheet.png',
  ...over,
});

describe('the Your mascot card on the brand page', () => {
  const card = (p: Partial<Parameters<typeof MascotCard>[0]>) =>
    renderToString(createElement(MascotCard, { brandId: 'b', reason: 'ok', active: null, inPosts: false, ...p }));

  it('shows Tween, the switch and a link to /mascot for a brand that may have one, before there is a mascot row', () => {
    const html = card({});
    expect(html).toContain(s.mascot.brandCard.statusOk);
    expect(html).toContain('href="/mascot"');
    expect(html).toContain(s.mascot.brandCard.makeOne);
    expect(html).toContain(s.mascot.brandCard.useInPosts);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toMatch(/checked/);
    expect(html).toContain('<svg'); // Tween
    expect(html).not.toMatch(/<text[\s>]|<image[\s>]/);
  });

  it('says a formal brand may still try one, and shows no switch until it has confirmed on the mascot screen', () => {
    const html = card({ reason: 'formal' });
    expect(html).toContain(s.mascot.brandCard.statusFormal);
    expect(html).toContain('href="/mascot"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('does not offer a regulated brand a mascot: no link, no switch, no drawing', () => {
    const html = card({ reason: 'regulated' });
    expect(html).toContain(s.mascot.brandCard.statusRegulated);
    expect(html).not.toContain('href="/mascot"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('<svg');
  });

  it('shows the name and the switch checked when it is on', () => {
    const off = card({ active: { id: 'm', name: 'Zuzu' }, inPosts: false });
    expect(off).toContain(fill(s.mascot.brandCard.haveOne, { name: 'Zuzu' }));
    expect(off).not.toMatch(/checked/);
    expect(card({ active: { id: 'm', name: 'Zuzu' }, inPosts: true })).toMatch(/checked/);
  });

  it('a regulated brand with an old mascot can reach it to download but cannot switch it on', () => {
    const html = card({ reason: 'regulated', active: { id: 'm', name: 'Tween' }, inPosts: false });
    expect(html).toContain('href="/mascot"');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe('the mascot screen', () => {
  const BRAND = { primary: '#c8283a', secondary: '#f6e7c8', accent: '#f2b100' };
  const screen = (p: Partial<Parameters<typeof MascotScreen>[0]>) =>
    renderToString(
      createElement(MascotScreen, { brandId: 'b', eligibility: { eligible: true, reason: 'ok', canOverride: false }, mascot: null, inPosts: false, brandColors: BRAND, downloads: [], ...p }),
    );

  it('shows Tween in a few poses, in the brand colour, with a name field, swatches and the switch', () => {
    const html = screen({});
    expect(html.match(/<svg /g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('#c8283a'); // the scarf, and the swatch
    expect(html).not.toContain('fill="#2B4CFF"'); // Tween is not drawn in Tween blue
    expect(html).toContain(s.mascot.nameLabel);
    expect(html).toContain('value="Tween"');
    for (const name of [s.mascot.swatch.primary, s.mascot.swatch.secondary, s.mascot.swatch.accent, s.mascot.swatch.tween]) expect(html).toContain(name);
    expect(html).toContain(s.mascot.useInPosts);
    expect(html).toContain(s.mascot.save);
    expect(html).not.toMatch(/<text[\s>]|<image[\s>]/);
    // No old concept flow.
    expect(html).not.toMatch(/Show me 3|Pick your mascot|Make a new mascot/);
  });

  it('marks the swatch for the scarf in use, and Tween blue is the only swatch when the brand has no colours', () => {
    expect(screen({ mascot: view({ scarf: '#f2b100' }) })).toMatch(/aria-pressed="true"[^>]*aria-label="Accent colour #F2B100"|aria-label="Accent colour #F2B100"[^>]*aria-pressed="true"/);
    const none = screen({ brandColors: {} });
    expect(none).toContain(s.mascot.swatch.tween);
    expect(none).not.toContain(s.mascot.swatch.primary);
  });

  it('shows the name and the sheet with download all once a mascot exists', () => {
    const downloads = mascotDownloads('b', 'm', 'Zuzu');
    const html = screen({ mascot: view({ name: 'Zuzu' }), downloads, inPosts: true });
    expect(html).toContain('value="Zuzu"');
    expect(html).toContain('/api/files/mascots/b/m/sheet.png');
    expect(html).toContain(s.mascot.downloadAll);
    expect(html).toMatch(/checked/);
    expect(downloads).toHaveLength(1 + 2 * TWEEN_POST_POSES.length);
  });

  it('shows why a regulated brand gets none, with no controls', () => {
    const html = screen({ eligibility: { eligible: false, reason: 'regulated', canOverride: false } });
    expect(html).toContain(s.mascot.regulatedTitle);
    expect(html).not.toContain(s.mascot.save);
    expect(html).not.toContain(s.mascot.tryAnyway);
    expect(html).not.toContain('<svg');
  });

  it('asks a formal brand to confirm with Try anyway first', () => {
    const html = screen({ eligibility: { eligible: false, reason: 'formal', canOverride: true } });
    expect(html).toContain(s.mascot.formalTitle);
    expect(html).toContain(s.mascot.tryAnyway);
    expect(html).not.toContain(s.mascot.save);
  });

  it('a formal brand that already has a mascot can edit it without confirming again', () => {
    const html = screen({ eligibility: { eligible: false, reason: 'formal', canOverride: true }, mascot: view() });
    expect(html).toContain(s.mascot.save);
    expect(html).not.toContain(s.mascot.tryAnyway);
  });
});

describe('ownership (D9)', () => {
  it("the mascot page says it is Tween in the owner's colours, to use and download", () => {
    expect(s.mascot.ownership).toBe('Tween, in your colours. Use it in your posts and download it any time.');
    expect(s.mascot.ownership).not.toMatch(/This mascot is yours/);
    expect(read('src/app/(app)/mascot/page.tsx')).toContain('{s.mascot.ownership}');
  });

  it('the terms page has the Tween clause and keeps the privacy section', () => {
    const html = renderToString(createElement(TermsPage));
    expect(html).toContain(s.terms.mascotHeading);
    expect(html).toContain(
      "Your mascot is Tween, the Weekly Posts character, drawn in your colours. You can use the images we make of it in your own posts and marketing, and download them any time. The character itself stays ours, so please don&#x27;t register it as your own trademark or logo.",
    );
    expect(html).not.toContain('You own your mascot');
    expect(html).toContain(s.terms.privacyHeading);
  });

  it('no old Namaste pose name is left in the copy', () => {
    expect(JSON.stringify(s.mascot)).not.toMatch(/Namaste/i);
    expect(Object.keys(s.mascot.poseNames)).toEqual([...TWEEN_POST_POSES]);
  });
});

describe('the post editor control', () => {
  const post = (over: Partial<WeekPostView> = {}): WeekPostView =>
    ({ id: 'p1', imageText: { headline: 'h', subline: 's' }, bubble: 'Hello!', pose: 'think', mascotId: 'm1', canShowMascot: true, ...over }) as WeekPostView;
  const html = (p: WeekPostView) =>
    renderToString(createElement(MascotControls, { post: p, weekStart: '2026-12-21', busy: null, run: async () => ({ ok: true, message: '', lines: [] }) as never }));

  it('shows Show mascot / No mascot, a pose picker with the 7 post poses and the bubble words when the post has a mascot', () => {
    const out = html(post());
    expect(out).toContain(s.mascot.post.title);
    expect(out).toContain(s.mascot.post.show);
    expect(out).toContain(s.mascot.post.hide);
    expect(out).toContain('value="Hello!"');
    expect(out).toContain(s.mascot.post.poseLabel);
    for (const p of TWEEN_POST_POSES) expect(out).toContain(`<option value="${p}"`);
    expect(out.match(/<option /g)).toHaveLength(7);
    expect(out).toMatch(/<option value="think" selected/);
  });

  it('starts the picker on wave when the post has no pose', () => {
    expect(html(post({ pose: '' }))).toMatch(/<option value="wave" selected/);
    expect(html(post({ pose: 'namaste' }))).toMatch(/<option value="wave" selected/);
  });

  it('offers it on a post without one when the brand has a mascot, and hides otherwise', () => {
    expect(html(post({ mascotId: null, canShowMascot: true }))).toContain(s.mascot.post.show);
    expect(html(post({ mascotId: null, canShowMascot: false }))).toBe('');
  });
});
