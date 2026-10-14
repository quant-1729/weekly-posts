// Carousel (C-20): one USP per slide when the owner picks more than a format can hold.

import { renderDesignDetailed, type DesignDetail } from './engine';
import { FORMAT_USP_CAPACITY, type DesignContent, type DesignFormat, type DesignInput } from './types';

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
