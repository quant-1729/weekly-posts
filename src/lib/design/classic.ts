// Classic theme, v2 path: for square, vertical and landscape, plain content (headline, subline, CTA, a
// mascot line) is drawn by the v2 templates themselves, so existing brands keep exactly the look they
// had (9-changes-v3.md section 14). Anything richer (USP lines, offer/date line, contact blocks, QR) or any other
// format goes through the new engine with the "classic-*" layout families, which carry the same look.

import { defaultTemplate, listTemplates, renderPostDetailed, templateInfo } from '@/lib/render';
import { detectDirection } from '@/lib/render';
import type { Box } from '@/lib/render';
import type { Dir } from '@/lib/render/shape';
import { safeZoneIssues, type DesignDetail } from './engine';
import { FORMAT_SIZE, type DesignFormat, type DesignInput } from './types';
import type { Placed } from './scene';

const V2_FORMATS: readonly DesignFormat[] = ['square', 'vertical', 'landscape'];
const PREFIX: Record<string, string> = { square: 'sq', vertical: 'tl', landscape: 'ls' };

export const isV2Format = (f: DesignFormat) => V2_FORMATS.includes(f);

/** The v2 template a classic layout id stands for in this format (a v2 id itself, or a classic-* recipe id), if there is one. */
export function v2TemplateFor(format: DesignFormat, layoutId: string | undefined, hasPhoto: boolean): string | null {
  if (!isV2Format(format)) return null;
  if (!layoutId) return defaultTemplate(format as 'square' | 'vertical' | 'landscape', hasPhoto, 0);
  const info = templateInfo(layoutId);
  if (info) return info.format === format ? layoutId : null;
  const p = PREFIX[format];
  switch (layoutId) {
    case 'classic-text':
      return `${p}-text`;
    case 'classic-card':
      return `${p}-text-card`;
    case 'classic-photo-band':
      return format === 'square' ? 'sq-photo-band' : format === 'vertical' ? 'tl-photo-top' : 'ls-photo-split';
    case 'classic-photo-full':
      return `${p}-photo-full`;
    default:
      return null;
  }
}

/** v2 template id -> the classic-* recipe that carries the same look in the new engine. */
export function recipeForV2(layoutId: string): string | undefined {
  if (!templateInfo(layoutId)) return undefined;
  if (layoutId.endsWith('-text-card')) return 'classic-card';
  if (layoutId.endsWith('-text')) return 'classic-text';
  if (layoutId.endsWith('-photo-full')) return 'classic-photo-full';
  return 'classic-photo-band';
}

export function v2Layouts(format: DesignFormat): { id: string; name: string; needsPhoto: boolean }[] {
  return listTemplates(format as 'square' | 'vertical' | 'landscape');
}

const union = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Returns null when the v2 templates cannot express the request (the engine then draws it). */
export async function renderClassicV2(input: DesignInput): Promise<DesignDetail | null> {
  const { format, content, kit } = input;
  if (!isV2Format(format)) return null;
  if (content.qr || content.blocks.length || content.offerLine || content.secondary.length || content.primary || input.slide || input.background) return null;
  if (input.scheme && input.scheme !== 'primary') return null;
  if (kit.source !== 'default' && (kit.fonts.headline !== 'sans' || kit.fonts.body !== 'sans')) return null;
  const hasPhoto = !!input.photo && input.photo.length > 0;
  const templateId = v2TemplateFor(format, input.layoutId, hasPhoto);
  if (!templateId) return null;
  const dir: Dir =
    input.dir === 'ltr' || input.dir === 'rtl' ? input.dir : detectDirection([content.headline, content.subline, content.cta?.text ?? ''].filter(Boolean).join(' '));
  const r = await renderPostDetailed({
    format: format as 'square' | 'vertical' | 'landscape',
    templateId,
    brand: {
      name: input.logo || kit.textLogo ? input.brandName : '',
      colors: { primary: kit.colors.primary, secondary: kit.colors.secondary, accent: kit.colors.accent },
      logo: input.logo ?? undefined,
    },
    photo: input.photo ?? undefined,
    text: { headline: content.headline, subline: content.subline, cta: content.cta?.text ?? '', bubble: content.bubble },
    mascot: input.mascot ?? null,
    dir,
  });
  const placements: Placed[] = r.placements.map((p) => {
    const lines = p.lines;
    const kind: Placed['kind'] = p.name === 'logo' ? 'logo' : p.name === 'mascot' ? 'mascot' : p.name === 'bubble' ? 'bubble' : 'text';
    return { name: p.name, kind, box: lines.length ? union(lines) : p.box, lines, size: p.size, text: p.text, truncated: p.truncated };
  });
  const { width, height } = FORMAT_SIZE[format];
  return {
    png: r.png,
    svg: r.svg,
    width,
    height,
    themeId: 'classic',
    layoutId: r.templateId,
    report: {
      overflow: placements.filter((p) => p.truncated).map((p) => p.name),
      dropped: [],
      contrast: [], // the v2 templates pick white or near-black ink for every colour block
      safeZone: safeZoneIssues(format, placements),
      qr: null,
    },
    scheme: 'primary',
    placements,
    qrBox: null,
    dir: r.dir,
    faces: { head: 'sans', body: 'sans' },
    mascotDropped: r.mascotDropped,
    freeSpace: 1,
    character: null,
    engine: 'v2',
  };
}
