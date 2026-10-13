import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock('@/app/(app)/brand/actions', () => ({ setMascotInPostsAction: vi.fn() }));
vi.mock('@/app/(app)/mascot/actions', () => ({ generateConceptsAction: vi.fn(), pickMascotAction: vi.fn() }));

import { MascotScreen } from '@/app/(app)/mascot/mascot-screen';
import TermsPage from '@/app/terms/page';
import { MascotCard } from '@/components/brand/mascot-card';
import { MascotControls } from '@/components/week/mascot-controls';
import { fill, s } from '@/lib/i18n/strings';
import { FIXTURE_SPECS } from '@/lib/mascot/fixtures';
import { mascotDownloads } from '@/lib/mascot/paths';
import type { MascotView } from '@/lib/mascot/service';
import type { WeekPostView } from '@/lib/weekly/view';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

const view = (over: Partial<MascotView> = {}): MascotView => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'active',
  name: 'Laddu',
  name_local: 'लड्डू',
  personality: 'Round, warm and always ready to share a sweet.',
  why_it_fits: '',
  spec: FIXTURE_SPECS[0],
  sheet_path: 'mascots/b/m/sheet.png',
  ...over,
});

describe('the Your mascot card on the brand page', () => {
  const card = (p: Partial<Parameters<typeof MascotCard>[0]>) =>
    renderToString(createElement(MascotCard, { brandId: 'b', reason: 'ok', active: null, inPosts: false, ...p }));

  it('offers to make one, with a link to /mascot, and no switch when there is none', () => {
    const html = card({});
    expect(html).toContain(s.mascot.brandCard.statusOk);
    expect(html).toContain('href="/mascot"');
    expect(html).toContain(s.mascot.brandCard.makeOne);
    expect(html).not.toContain(s.mascot.brandCard.useInPosts);
    expect(html).not.toContain('type="checkbox"');
  });

  it('says a formal brand may still try one', () => {
    const html = card({ reason: 'formal' });
    expect(html).toContain(s.mascot.brandCard.statusFormal);
    expect(html).toContain('href="/mascot"');
  });

  it('does not offer a regulated brand a mascot: no link, no switch', () => {
    const html = card({ reason: 'regulated' });
    expect(html).toContain(s.mascot.brandCard.statusRegulated);
    expect(html).not.toContain('href="/mascot"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('shows "Use my mascot in posts" only when a mascot exists, checked when it is on', () => {
    const off = card({ active: { id: 'm', name: 'Laddu' }, inPosts: false });
    expect(off).toContain(fill(s.mascot.brandCard.haveOne, { name: 'Laddu' }));
    expect(off).toContain(s.mascot.brandCard.useInPosts);
    expect(off).toContain('type="checkbox"');
    expect(off).not.toMatch(/checked/);
    expect(card({ active: { id: 'm', name: 'Laddu' }, inPosts: true })).toMatch(/checked/);
  });

  it('a regulated brand with an old mascot can reach it to download but cannot switch it on', () => {
    const html = card({ reason: 'regulated', active: { id: 'm', name: 'Laddu' }, inPosts: false });
    expect(html).toContain('href="/mascot"');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe('the mascot screen', () => {
  const screen = (p: Partial<Parameters<typeof MascotScreen>[0]>) =>
    renderToString(createElement(MascotScreen, { eligibility: { eligible: true, reason: 'ok', canOverride: false }, active: null, downloads: [], concepts: [], ...p }));

  it('asks for an idea and offers 3 mascots', () => {
    const html = screen({});
    expect(html).toContain(s.mascot.makeConcepts);
    expect(html).toContain(s.mascot.hintLabel);
  });

  it('shows 3 drawn concepts to pick from', () => {
    const concepts = FIXTURE_SPECS.map((spec, i) => view({ id: `00000000-0000-4000-8000-00000000000${i}`, status: 'concept', name: ['Laddu', 'Jalebi', 'Mithu'][i], spec }));
    const html = screen({ concepts });
    expect(html.match(/<svg /g)!.length).toBeGreaterThanOrEqual(3);
    expect(html.match(new RegExp(s.mascot.pick, 'g'))).toHaveLength(3);
    expect(html).not.toMatch(/<text[\s>]|<image[\s>]/);
  });

  it('shows why a regulated brand gets none, with no way to make one', () => {
    const html = screen({ eligibility: { eligible: false, reason: 'regulated', canOverride: false } });
    expect(html).toContain(s.mascot.regulatedTitle);
    expect(html).not.toContain(s.mascot.makeConcepts);
    expect(html).not.toContain(s.mascot.tryAnyway);
  });

  it('asks a formal brand to confirm with Try anyway first', () => {
    const html = screen({ eligibility: { eligible: false, reason: 'formal', canOverride: true } });
    expect(html).toContain(s.mascot.formalTitle);
    expect(html).toContain(s.mascot.tryAnyway);
    expect(html).not.toContain(s.mascot.makeConcepts);
  });

  it('shows the active mascot with its sheet, download all and make-a-new-one', () => {
    const downloads = mascotDownloads('b', 'm', 'Laddu');
    const html = screen({ active: view(), downloads });
    expect(html).toContain(s.mascot.activeTitle);
    expect(html).toContain('/api/files/mascots/b/m/sheet.png');
    expect(html).toContain(s.mascot.downloadAll);
    expect(html).toContain(s.mascot.makeNew);
    expect(html).toContain(s.mascot.makeNewHelp);
  });
});

describe('ownership (old R15f)', () => {
  it('the mascot page says the mascot is the owner\'s and can be downloaded', () => {
    expect(s.mascot.ownership).toMatch(/This mascot is yours\. You can download and use it anywhere/);
    expect(read('src/app/(app)/mascot/page.tsx')).toContain('{s.mascot.ownership}');
  });

  it('the terms page still has the ownership clause, after the privacy edits', () => {
    const html = renderToString(createElement(TermsPage));
    expect(html).toContain(s.terms.mascotHeading);
    expect(html).toContain('You own your mascot and all its images');
    expect(html).toContain('we claim no ownership of them');
    expect(html).toContain(s.terms.privacyHeading); // V-20's privacy section is there too
  });
});

describe('the post editor control', () => {
  const post = (over: Partial<WeekPostView> = {}): WeekPostView =>
    ({ id: 'p1', imageText: { headline: 'h', subline: 's' }, bubble: 'Hello!', mascotId: 'm1', canShowMascot: true, ...over }) as WeekPostView;
  const html = (p: WeekPostView) =>
    renderToString(createElement(MascotControls, { post: p, weekStart: '2026-12-21', busy: null, run: async () => ({ ok: true, message: '', lines: [] }) as never }));

  it('shows Show mascot / No mascot and the bubble words when the post has a mascot', () => {
    const out = html(post());
    expect(out).toContain(s.mascot.post.title);
    expect(out).toContain(s.mascot.post.show);
    expect(out).toContain(s.mascot.post.hide);
    expect(out).toContain('value="Hello!"');
  });

  it('offers it on a post without one when the brand has a mascot, and hides otherwise', () => {
    expect(html(post({ mascotId: null, canShowMascot: true }))).toContain(s.mascot.post.show);
    expect(html(post({ mascotId: null, canShowMascot: false }))).toBe('');
  });
});
