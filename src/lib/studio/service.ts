// The Design Studio's server side for a post brief: what the studio starts from (the requirement stage's details),
// saving the owner's documents, and "Use this design" (stored pictures for every channel). Server-only.

import sharp from 'sharp';
import { getBrief } from '@/lib/briefs/service';
import type { Brief, UspSnapshot } from '@/lib/briefs/types';
import { blockLines } from '@/lib/briefs/editor-state';
import { drawCharacter } from '@/lib/characters';
import { applyStudioDesign, briefFormats, channelFormats, contentFromBrief, listBriefPosts, ensureDraftPosts, loadCreateBrand, loadDesignAssets, offerLineFor, shownBlocks, type CreateBrand } from '@/lib/create';
import { getDb } from '@/lib/db';
import type { DesignFormat } from '@/lib/design/types';
import type { DesignAssets } from '@/lib/create/render';
import { FACE_BUCKET, relOfStored } from '@/lib/faces/paths';
import { faceShownFor } from '@/lib/faces/rules';
import { FACE_POSES } from '@/lib/faces/types';
import { getStorage } from '@/lib/storage';
import { mix } from './color';
import { aiTagOutside } from './scene';
import { analyzePixels } from './photo';
import { adaptDoc, normalize, wordsOf } from './ops';
import { getServerShaper, renderStudioDoc } from './server';
import { STUDIO_FORMATS, studioStateSchema, type StudioContact, type StudioDoc, type StudioFace, type StudioFormat, type StudioInput, type StudioPhoto, type StudioState } from './types';

export interface StudioPhotoView {
  id: string;
  src: string;
  w: number;
  h: number;
  description: string;
}

export interface StudioPage {
  briefId: string;
  input: StudioInput;
  formats: StudioFormat[];
  initial: StudioState | null;
  photos: StudioPhotoView[];
  contacts: StudioContact[];
  /** Words on the picture the fact check asks about (they are confirmed or removed in Review). */
  checks: string[];
}

const CONTACT_KINDS: StudioContact['kind'][] = ['phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'instagram', 'facebook', 'youtube'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$', AED: 'AED ', SGD: 'S$' };

/** The big offer words from the main selling point ("20% OFF", "₹50 OFF", "₹99 ONLY"), or ''. */
export function offerText(u: UspSnapshot | undefined): string {
  if (!u) return '';
  const d = (u.details ?? {}) as Record<string, unknown>;
  const upTo = d.upTo === true ? 'UP TO ' : '';
  if (u.kind === 'discount') {
    const p = num(d.percent);
    if (p !== null) return `${upTo}${p}% OFF`;
    const off = d.amountOff as { amount?: number; currency?: string } | undefined;
    if (off?.amount) return `${upTo}${SYMBOL[off.currency ?? ''] ?? `${off.currency} `}${off.amount} OFF`;
  }
  if (u.kind === 'price') {
    const pr = d.price as { amount?: number; currency?: string } | undefined;
    if (pr?.amount) return `${SYMBOL[pr.currency ?? ''] ?? `${pr.currency} `}${pr.amount}`;
  }
  if (u.kind === 'free_extra') return 'FREE';
  return '';
}

/** "on all cakes · Mon 20 Oct": what the offer is on, and when. */
export function offerNote(brief: Brief, language: string): string {
  const primary = brief.uspSnapshot.find((u) => u.role === 'primary');
  const parts: string[] = [];
  const on = primary && primary.kind === 'discount' ? String((primary.details as Record<string, unknown>).on ?? '') : primary && primary.kind === 'price' ? String((primary.details as Record<string, unknown>).item ?? '') : '';
  if (on && !/^every(thing| item)?$/i.test(on)) parts.push(on[0].toUpperCase() + on.slice(1));
  if (brief.startsOn && brief.startsOn === brief.endsOn && brief.blocks.dates !== false) {
    const [y, m, d] = brief.startsOn.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
    parts.push(`${day} only`);
    return [...new Set(parts)].join(' · ');
  }
  const line = offerLineFor(brief, language);
  // offerLineFor repeats the amount when the title lacks it; keep only the dates part.
  if (line) for (const part of line.split(' · ')) if (!/\d+\s*%|off\b/i.test(part) || !primary) parts.push(part);
  return [...new Set(parts)].join(' · ');
}

export const studioFormatsOf = (formats: readonly DesignFormat[]): StudioFormat[] => formats.filter((f): f is StudioFormat => (STUDIO_FORMATS as readonly string[]).includes(f));

async function photoInfo(userId: string, brandId: string, photoId: string | null): Promise<StudioPhoto | null> {
  if (!photoId) return null;
  const [p] = await getDb().withUser(userId, (tx) =>
    tx.query<{ storage_path: string | null; width: number | null; height: number | null; description: string | null }>("select storage_path, width, height, description from public.photos where id = $1 and brand_id = $2 and kind = 'photo'", [photoId, brandId]),
  );
  if (!p?.storage_path) return null;
  const storage = getStorage();
  const [bucket, ...rest] = p.storage_path.split('/');
  const file = await storage.get(bucket as never, rest.join('/')).catch(() => null);
  let w = p.width ?? 1000;
  let h = p.height ?? 1000;
  let colors: string[] | undefined;
  let focus: { x: number; y: number } | undefined;
  let plain: boolean | undefined;
  if (file) {
    try {
      const meta = await sharp(Buffer.from(file.bytes)).metadata();
      w = meta.width ?? w;
      h = meta.height ?? h;
      const { data, info } = await sharp(Buffer.from(file.bytes)).resize(120, 120, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const a = analyzePixels(data, info.width, info.height);
      colors = a.colors;
      focus = a.focus;
      plain = a.plainBackground;
    } catch {
      /* the photo still works without the analysis */
    }
  }
  return { id: photoId, src: `/api/files/${p.storage_path}`, w, h, colors, focus, plainBackground: plain, description: p.description ?? undefined };
}

/**
 * The brand's pose-image face for the studio (illustrated, realistic AI person, or the owner's own photos), when the face is
 * on for this brief. Poses are read from the brand's own files; the studio draws them as picture layers (our own file route).
 */
export async function studioFaceOf(assets: DesignAssets, wantPose: string): Promise<StudioFace | null> {
  const f = assets.face;
  if (!assets.faceOn || !f || f.kind === 'mascot' || !f.poses) return null;
  const poses: StudioFace['poses'] = {};
  for (const pose of FACE_POSES) {
    const rel = relOfStored(f.poses[pose]);
    if (!rel) continue;
    const file = await assets.storage.get(FACE_BUCKET, rel).catch(() => null);
    if (!file) continue;
    const meta = await sharp(Buffer.from(file.bytes)).metadata().catch(() => null);
    if (!meta?.width || !meta.height) continue;
    poses[pose] = { src: `/api/files/${FACE_BUCKET}/${rel}`, w: meta.width, h: meta.height };
  }
  const keys = Object.keys(poses);
  if (keys.length === 0) return null;
  const pose = poses[wantPose] ? wantPose : poses.wave ? 'wave' : keys[0];
  return { name: f.name, ai: f.kind === 'photoreal', pose, poses };
}

/** The face a design may show for this brief (the brand rules: type limits, no realistic AI person on a testimonial, regulated brands). */
async function faceAllowed(userId: string, brandId: string, briefId: string): Promise<{ id: string | null; ai: boolean } | null> {
  const [brief, brand] = await Promise.all([getBrief(userId, brandId, briefId), loadCreateBrand(userId, brandId)]);
  const f = brand.face;
  if (!brief || !f || f.kind === 'mascot' || !f.poses || !faceShownFor(f, brief.postType)) return null;
  return { id: f.id, ai: f.kind === 'photoreal' };
}

const FACE_SRC = /^\/api\/files\/mascots\/([^/]+)\/faces\/([^/]+)\//;

/**
 * Keeps a document to the Brand Face rules whatever the saved design says: a picture of a face that is not the one allowed
 * for this post (another brand's, an old face, a realistic AI person on a testimonial, a face since switched off) is taken
 * out, and a realistic AI person always carries its "AI" tag.
 */
export function enforceFace(doc: StudioDoc, brandId: string, face: { id: string | null; ai: boolean } | null): StudioDoc {
  let changed = false;
  const layers: StudioDoc['layers'] = [];
  for (const l of doc.layers) {
    const m = l.kind === 'image' ? FACE_SRC.exec(l.src.split('?')[0]) : null;
    if (l.kind === 'image' && m) {
      if (!face || m[1] !== brandId || m[2] !== face.id) {
        changed = true;
        continue;
      }
      if (face.ai && l.ai !== true) {
        changed = true;
        layers.push({ ...l, ai: true });
        continue;
      }
    }
    layers.push(l);
  }
  return changed ? { ...doc, layers } : doc;
}

async function logoInfo(brand: CreateBrand, brief: Brief): Promise<StudioInput['brand']['logo']> {
  if (!brand.logoPath || brief.blocks.logo === false) return null;
  const [bucket, ...rest] = brand.logoPath.split('/');
  const file = await getStorage().get(bucket as never, rest.join('/')).catch(() => null);
  if (!file) return null;
  const meta = await sharp(Buffer.from(file.bytes)).metadata().catch(() => null);
  return { src: `/api/files/${brand.logoPath}`, w: meta?.width ?? 400, h: meta?.height ?? 200 };
}

/** Everything the studio starts from for one brief. */
export async function loadStudioPage(args: { userId: string; brandId: string; briefId: string }): Promise<StudioPage | null> {
  const { userId, brandId, briefId } = args;
  const brief = await getBrief(userId, brandId, briefId);
  if (!brief) return null;
  const [{ posts }, brand] = await Promise.all([ensureDraftPosts({ userId, brandId, briefId }), loadCreateBrand(userId, brandId)]);
  const first = posts[0];
  const assets = await loadDesignAssets({ userId, brandId, brief, brand });
  const language = brief.language ?? brand.language;
  const words = { headline: first.imageText.headline, subline: first.imageText.subline, ctaText: first.cta, bubble: first.imageText.bubble };
  const content = await contentFromBrief(brief, brand, words, { postCode: first.postCode, mascot: assets.faceOn });
  const primary = brief.uspSnapshot.find((u) => u.role === 'primary');
  const blocks = shownBlocks(brief, brand);
  const contacts = blocks.filter((b): b is { kind: StudioContact['kind']; text: string } => (CONTACT_KINDS as string[]).includes(b.kind)).map((b) => ({ kind: b.kind, text: b.text }));
  const all = blockLines({ contacts: brand.contacts, hasLogo: brand.hasLogo, startsOn: '', endsOn: '' })
    .filter((l) => (CONTACT_KINDS as string[]).includes(l.key) && l.text)
    .map((l) => ({ kind: l.key as StudioContact['kind'], text: l.text! }));

  const kit = assets.kit;
  const mascot = assets.characterId ? drawCharacter(assets.characterId, 'wave', { accent: kit.colors.accent, accentDark: mix(kit.colors.accent, '#000000', 0.4) }) : null;
  const [photo, logo, face] = await Promise.all([photoInfo(userId, brandId, brief.photoId), logoInfo(brand, brief), studioFaceOf(assets, first.imageText.pose)]);

  const [row] = await getDb().withUser(userId, (tx) => tx.query<{ studio: unknown }>('select studio from public.post_briefs where id = $1 and brand_id = $2', [briefId, brandId]));
  const parsed = row?.studio ? studioStateSchema.safeParse(row.studio) : null;
  const designFormats = studioFormatsOf(briefFormats(brief.channels));

  const photos = await getDb().withUser(userId, (tx) =>
    tx.query<{ id: string; storage_path: string; width: number | null; height: number | null; description: string | null }>(
      `select id::text as id, storage_path, width, height, description from public.photos where brand_id = $1 and kind = 'photo' and storage_path is not null order by created_at desc limit 24`,
      [brandId],
    ),
  );

  return {
    briefId,
    input: {
      format: designFormats[0] ?? 'square',
      content: {
        brandName: brand.name,
        headline: content.headline,
        subline: content.subline,
        offer: offerText(primary),
        offerNote: offerNote(brief, language),
        cta: content.cta?.text ?? '',
        contacts,
        qr: content.qr ? { data: content.qr.text, label: content.qr.label } : null,
        language,
      },
      brand: {
        colors: kit.colors,
        fonts: kit.fonts,
        logo,
        character: mascot ? { svg: `<g transform="translate(10 0)">${mascot.body}</g>`, vw: 260, vh: 260 } : null,
        face,
      },
      photo,
    },
    formats: designFormats.length ? designFormats : ['square'],
    initial: parsed?.success ? parsed.data : null,
    photos: photos.map((p) => ({ id: p.id, src: `/api/files/${p.storage_path}`, w: p.width ?? 1000, h: p.height ?? 1000, description: p.description ?? '' })),
    contacts: all,
    checks: [...new Set(posts.flatMap((p) => p.flags).filter((f) => f.status === 'open' && f.field !== 'caption' && f.kind !== 'regulated_reminder').map((f) => f.text))].slice(0, 6),
  };
}

const MAX_STATE_BYTES = 6_000_000;

export function parseStudioState(raw: unknown): StudioState | null {
  const r = studioStateSchema.safeParse(raw);
  if (!r.success) return null;
  if (JSON.stringify(r.data).length > MAX_STATE_BYTES) return null;
  return r.data;
}

export async function saveStudioState(args: { userId: string; brandId: string; briefId: string; state: unknown }): Promise<boolean> {
  const state = parseStudioState(args.state);
  if (!state) return false;
  const rows = await getDb().withUser(args.userId, (tx) =>
    tx.query<{ id: string }>('update public.post_briefs set studio = $3::jsonb where id = $1 and brand_id = $2 returning id::text as id', [args.briefId, args.brandId, JSON.stringify({ ...state, updatedAt: new Date().toISOString() })]),
  );
  return rows.length > 0;
}

/** The words a document shows, as the guardrail checks them: the headline, every other line on the picture, the button. */
export function studioWords(doc: StudioDoc): { headline: string; subline: string; ctaText: string } {
  const w = wordsOf(doc);
  const others: string[] = [];
  for (const l of doc.layers) {
    if (l.hidden) continue;
    if ((l.kind === 'text' || l.kind === 'badge') && l.role !== 'headline' && l.role !== 'cta' && l.role !== 'brand' && l.role !== 'qrLabel' && l.text.trim()) others.push(l.text.replace(/\n/g, ' ').trim());
  }
  return { headline: w.headline ?? '', subline: [...new Set(others)].join(' · '), ctaText: w.cta ?? '' };
}

/** "Use this design": checks the words, draws every size, stores the pictures. */
export async function finishStudio(args: { userId: string; brandId: string; briefId: string; state: unknown; input: StudioInput }): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = parseStudioState(args.state);
  if (!state) return { ok: false, message: 'The design could not be read. Please try again.' };
  await saveStudioState({ ...args, state });
  const shaper = await getServerShaper();
  const main = state.docs[state.main] ?? Object.values(state.docs).find(Boolean);
  if (!main) return { ok: false, message: 'Pick a design first.' };
  // Brand Face rules hold whatever the saved design says; a realistic AI person's tag has to be on the poster.
  const face = await faceAllowed(args.userId, args.brandId, args.briefId);
  const docs = new Map<StudioFormat, StudioDoc>();
  for (const f of STUDIO_FORMATS) docs.set(f, enforceFace(state.docs[f] ?? adaptDoc(main, f, args.input, shaper), args.brandId, face));
  for (const [f, doc] of docs) {
    if (aiTagOutside(doc, shaper).length > 0) return { ok: false, message: `The picture of the AI person (${f}) has moved partly off the poster, so its "AI" tag would not show. Move it back onto the poster.` };
  }
  await applyStudioDesign({
    userId: args.userId,
    brandId: args.brandId,
    briefId: args.briefId,
    words: studioWords(enforceFace(main, args.brandId, face)),
    formats: [...STUDIO_FORMATS],
    draw: async ({ format, qrData }) => {
      const doc = docs.get(format as StudioFormat);
      if (!doc) return null;
      const r = await renderStudioDoc(doc, { brandId: args.brandId, qrData });
      return { png: r.png, problems: r.problems, aiFace: r.aiFace };
    },
  });
  return { ok: true };
}

/**
 * After the pipeline drew a brief's pictures again (a flagged phrase removed in Review, "Undo all", a filter), the sizes
 * the owner designed in the studio are drawn again from their documents, with the post's current headline and button.
 */
export async function restampStudio(userId: string, brandId: string, briefId: string): Promise<void> {
  const [row] = await getDb().withService((tx) => tx.query<{ studio: unknown }>('select studio from public.post_briefs where id = $1 and brand_id = $2', [briefId, brandId]));
  const state = row?.studio ? parseStudioState(row.studio) : null;
  if (!state) return;
  const page = await loadStudioPage({ userId, brandId, briefId });
  if (!page) return;
  const shaper = await getServerShaper();
  const main = state.docs[state.main] ?? Object.values(state.docs).find(Boolean);
  if (!main) return;
  const brief = await getBrief(userId, brandId, briefId);
  if (!brief) return;
  const brand = await loadCreateBrand(userId, brandId);
  const storage = getStorage();
  const face = await faceAllowed(userId, brandId, briefId);
  for (const p of await listBriefPosts(userId, brandId, briefId)) {
    if (!p.design) continue;
    const content = await contentFromBrief(brief, brand, { headline: p.imageText.headline, subline: p.imageText.subline, ctaText: p.cta, bubble: p.imageText.bubble }, { postCode: p.postCode });
    const drawn: StudioFormat[] = [];
    let studioAi = false;
    for (const f of channelFormats(p.channel)) {
      if (!(STUDIO_FORMATS as readonly string[]).includes(f)) continue;
      const base = enforceFace(state.docs[f as StudioFormat] ?? adaptDoc(main, f as StudioFormat, page.input, shaper), brandId, face);
      const doc: StudioDoc = {
        ...base,
        layers: base.layers.map((l) => (l.kind === 'text' && l.role === 'headline' ? normalize({ ...l, text: p.imageText.headline }, shaper) : l.kind === 'text' && l.role === 'cta' && p.cta ? normalize({ ...l, text: p.cta }, shaper) : l)),
      };
      const r = await renderStudioDoc(doc, { brandId, qrData: content.qr?.text ?? null });
      await storage.put('renders', `${brandId}/${p.id}/${f}.png`, r.png, 'image/png');
      drawn.push(f as StudioFormat);
      if (r.aiFace) studioAi = true;
    }
    if (drawn.length) {
      // The caption gets the AI disclosure when a realistic AI person is on any picture of the post (the studio's or the engine's).
      const engineAi = p.design.aiFace === true && channelFormats(p.channel).some((f) => !drawn.includes(f as StudioFormat));
      const { aiFace: _was, ...rest } = p.design;
      void _was;
      const design = { ...rest, studio: { formats: drawn }, ...(studioAi || engineAi ? { aiFace: true as const } : {}) };
      await getDb().withService((tx) => tx.query('update public.posts set design = $3::jsonb where id = $1 and brand_id = $2', [p.id, brandId, JSON.stringify(design)]));
    }
  }
}
