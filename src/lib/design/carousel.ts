// Carousel (C-20): one USP per slide when the owner picks more than a format can hold.

import type { CharacterRole } from '@/lib/characters/types';
import { roleSupported, type Band } from './character';
import { renderDesignDetailed, type DesignDetail } from './engine';
import { FORMAT_USP_CAPACITY, type CharacterSource, type DesignContent, type DesignFormat, type DesignInput, type SlideKind, type SlideText } from './types';

/** True when the content has more secondary USP lines than the format can show (offer a carousel). */
export function needsCarousel(content: DesignContent, format: DesignFormat): boolean {
  return content.secondary.length > FORMAT_USP_CAPACITY[format].secondary;
}

/**
 * Split content into slides: slide 1 = headline, supporting line, primary USP and the offer/date line;
 * then one slide per secondary USP; the last slide = the call to action (as its headline), the contact
 * blocks and the QR. Content with no secondary USP is returned as a single slide. The caller decides
 * when a carousel is wanted (see needsCarousel).
 */
export function splitIntoSlides(content: DesignContent, format: DesignFormat): DesignContent[] {
  void format;
  if (!content.secondary.length) return [content];
  const empty = (): Pick<DesignContent, 'subline' | 'primary' | 'secondary' | 'offerLine' | 'cta' | 'blocks' | 'qr'> => ({ subline: '', primary: null, secondary: [], offerLine: null, cta: null, blocks: [], qr: null });
  const slides: DesignContent[] = [
    { ...content, ...empty(), headline: content.headline, subline: content.subline, primary: content.primary, offerLine: content.offerLine },
  ];
  for (const s of content.secondary) {
    slides.push({ ...content, ...empty(), headline: s.text });
  }
  if (content.cta || content.blocks.length || content.qr) {
    slides.push({ ...content, ...empty(), headline: content.cta?.text ?? '', blocks: content.blocks, qr: content.qr });
  }
  return slides;
}

/**
 * Render every slide with its "1/4" marker. All slides use the layout family and colour scheme slide 1
 * ended up with, so the set looks like one carousel.
 */
export async function renderCarousel(input: Omit<DesignInput, 'slide'>): Promise<DesignDetail[]> {
  const slides = splitIntoSlides(input.content, input.format);
  const total = slides.length;
  const out: DesignDetail[] = [];
  let layoutId = input.layoutId;
  let scheme = input.scheme;
  for (let i = 0; i < total; i++) {
    const r = await renderDesignDetailed({ ...input, content: slides[i], layoutId, scheme, slide: total > 1 ? { index: i + 1, total } : null });
    if (i === 0) {
      layoutId = r.layoutId;
      scheme = r.scheme;
    }
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// A carousel the owner asked for (owner request 2026-10-16): a SET of slides in one design
// ---------------------------------------------------------------------------------------------

const norm = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The content of every slide from the post's content (contacts, the code and the call to action come from it) and the slide
 * words. Cover, point and proof slides carry words only; the closing slide carries the contact lines, the QR and, when no proof
 * slide says it, the offer line. On a proof slide the headline is the fact itself, so a character's sign can hold it. Pure.
 */
export function slideContents(base: DesignContent, slides: readonly SlideText[]): DesignContent[] {
  const hasProof = slides.some((x) => x.kind === 'proof');
  return slides.map((sl) => {
    const content: DesignContent = { ...base, headline: sl.headline, subline: sl.body, primary: null, secondary: [], offerLine: null, cta: null, blocks: [], qr: null, bubble: '' };
    if (sl.kind !== 'cta') return content;
    return {
      ...content,
      offerLine: hasProof ? null : base.offerLine,
      // The headline of the closing slide is the call to action; the button text is not said twice.
      cta: base.cta && norm(base.cta.text) !== norm(sl.headline) ? base.cta : null,
      blocks: base.blocks,
      qr: base.qr,
    };
  });
}

/** The roles a slide may take, best first (the first one the character can take is used). Points rotate pointer, narrator, percher. */
export function slideRoleCandidates(kind: SlideKind, pointIndex: number): { roles: CharacterRole[]; band?: Band } {
  switch (kind) {
    case 'cover':
      return { roles: ['presenter', 'pointer'], band: 'lead' };
    case 'point': {
      const rotation: CharacterRole[] = ['pointer', 'narrator', 'percher'];
      return { roles: [rotation[pointIndex % rotation.length], 'pointer', 'presenter'], band: 'support' };
    }
    case 'proof':
      return { roles: ['sign_holder', 'presenter'] };
    case 'cta':
      return { roles: ['pointer', 'presenter'], band: 'support' };
  }
}

/**
 * Draws the slides of one design option as a set. Every slide uses the layout family and colour scheme the cover ended up with,
 * and the point slides keep the side the first of them took, so the set reads as one carousel. With a character the role follows
 * the slide (`slideRoleCandidates`: the cover presents in the Lead band, points point, narrate or perch in the Support band, the
 * proof is held on a sign, the closing slide points at the code or the call to action); without one every slide is typographic.
 * Each slide carries its "2/5" marker, drawn by code.
 */
export async function renderSlideSet(args: {
  /** The input of the option as built for a single picture (kit, theme, layout, scheme, photo, filter, seed). Its content, role and character are replaced per slide. */
  input: Omit<DesignInput, 'slide'>;
  slides: readonly SlideText[];
  /** The character for a role (the rig, or the pose image the role needs); null when it cannot take that role. Omit for a typographic set (no character). */
  characterFor?: (role: CharacterRole) => Promise<CharacterSource | null>;
}): Promise<DesignDetail[]> {
  const { input, slides } = args;
  const contents = slideContents(input.content, slides);
  const total = slides.length;
  const out: DesignDetail[] = [];
  let layoutId = input.layoutId;
  let scheme = input.scheme;
  let bodySide: 'left' | 'right' | undefined;
  let pointNo = 0;
  for (let i = 0; i < total; i++) {
    const kind = slides[i].kind;
    let role: CharacterRole | null = null;
    let character: CharacterSource | null = null;
    let band: Band | undefined;
    if (args.characterFor) {
      const cand = slideRoleCandidates(kind, kind === 'point' ? pointNo : 0);
      band = cand.band;
      for (const r of cand.roles) {
        const src = await args.characterFor(r);
        if (src && roleSupported(r, src, input.format)) {
          role = r;
          character = src;
          break;
        }
      }
    }
    const r = await renderDesignDetailed({
      ...input,
      content: contents[i],
      layoutId,
      scheme,
      role,
      character,
      charBand: role ? band : undefined,
      charSide: kind === 'point' ? bodySide : undefined,
      slide: { index: i + 1, total, kind },
    });
    if (i === 0) {
      layoutId = r.layoutId;
      scheme = r.scheme;
    }
    if (kind === 'point') {
      pointNo++;
      if (!bodySide && r.character) bodySide = r.character.side;
    }
    out.push(r);
  }
  return out;
}
