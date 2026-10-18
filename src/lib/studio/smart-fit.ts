// "Blend into poster": how to fit the owner's own photo into a design. With live AI, Gemini looks at the photo (one small
// call, about $0.002) and suggests where the subject is, which treatment suits it and which colours carry the mood. Offline
// (or if the call fails) the same answer comes from code (src/lib/studio/photo.ts). The AI never draws or changes the photo.

import sharp from 'sharp';
import { z } from 'zod';
import { aiMode, generateJson } from '@/lib/ai/client';
import { getDb } from '@/lib/db';
import { getStorage } from '@/lib/storage';

export const smartFitSchema = z.object({
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  treatment: z.enum(['cutout', 'frame', 'fade', 'full']),
  mask: z.enum(['rounded', 'circle', 'arch', 'blob', 'squircle']).optional(),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(5),
  mood: z.string().max(120),
});
export type SmartFit = z.infer<typeof smartFitSchema>;

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    focus: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    treatment: { type: 'string', enum: ['cutout', 'frame', 'fade', 'full'] },
    mask: { type: 'string', enum: ['rounded', 'circle', 'arch', 'blob', 'squircle'] },
    colors: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    mood: { type: 'string' },
  },
  required: ['focus', 'treatment', 'colors', 'mood'],
};

const SYSTEM = `You help a small shop owner place their own product photo on a social media poster.
Look at the photo and answer in JSON only:
- focus: where the main subject's centre is, as fractions of width (x) and height (y).
- treatment: "cutout" if the subject sits on a plain, even background that can be removed cleanly; "fade" if it is a wide scene that should melt into the poster; "frame" for most other photos; "full" only for a striking photo that should fill the poster.
- mask: the frame shape that suits the subject (round things: circle; tall things: arch; playful: blob; else rounded).
- colors: 3 to 5 hex colours taken from the photo that would make a good poster palette (one deep, one light, one vivid).
- mood: one short friendly sentence (max 12 words) about the photo's mood, no prices, no claims.
Never describe people's identity. Never invent text.`;

export interface CodeHints {
  colors: string[];
  plainBackground: boolean;
  focus: { x: number; y: number };
  busy: number;
}

export function codeFit(h: CodeHints): SmartFit {
  return {
    focus: h.focus,
    treatment: h.plainBackground ? 'cutout' : h.busy > 0.55 ? 'frame' : 'fade',
    mask: 'rounded',
    colors: h.colors.slice(0, 5),
    mood: '',
  };
}

export async function smartFit(args: { userId: string; brandId: string; photoId?: string; hints: CodeHints }): Promise<SmartFit & { source: 'ai' | 'code' }> {
  const fallback = { ...codeFit(args.hints), source: 'code' as const };
  if (aiMode() === 'fixture' || !args.photoId) return fallback;
  try {
    const [p] = await getDb().withUser(args.userId, (tx) =>
      tx.query<{ storage_path: string | null }>("select storage_path from public.photos where id = $1 and brand_id = $2 and kind = 'photo'", [args.photoId, args.brandId]),
    );
    if (!p?.storage_path) return fallback;
    const [bucket, ...rest] = p.storage_path.split('/');
    const file = await getStorage().get(bucket as never, rest.join('/'));
    if (!file) return fallback;
    const small = await sharp(Buffer.from(file.bytes)).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    const { data } = await generateJson({
      system: SYSTEM,
      user: 'Here is the photo.',
      media: [{ mimeType: 'image/jpeg', data: small }],
      zodSchema: smartFitSchema,
      jsonSchema: JSON_SCHEMA,
      temperature: 0.3,
      timeoutMs: 15_000,
      budgetMs: 20_000,
      logContext: { brandId: args.brandId },
    });
    return { ...data, colors: data.colors.length >= 2 ? data.colors : fallback.colors, source: 'ai' };
  } catch (e) {
    console.error('[studio] smart fit fell back to code', e);
    return fallback;
  }
}
