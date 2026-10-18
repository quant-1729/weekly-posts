// Design Studio document model. Pure types + validation: safe to import in the browser and on the server.
//
// A studio document is the single source of truth for a poster: a stack of layers on a fixed-size canvas.
// The browser draws it live while the owner edits; the server draws the exact same SVG (same shaper, same
// scene builder) and rasterises it with resvg for the stored PNG. All text is shaped by code into paths;
// no AI ever draws text, logos or QR codes.

import { z } from 'zod';

export const STUDIO_FORMATS = ['square', 'portrait', 'vertical'] as const;
export type StudioFormat = (typeof STUDIO_FORMATS)[number];

export const STUDIO_SIZE: Record<StudioFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  vertical: { width: 1080, height: 1920 },
};

/** Story apps cover the top and bottom of a 9:16 picture: keep words between these lines. */
export const STORY_SAFE = { top: 250, bottom: 1580 } as const;

// ---------------------------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const stop = z.object({ at: z.number().min(0).max(1), color: hex, alpha: z.number().min(0).max(1).optional() });

export const paintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: hex }),
  z.object({ kind: z.literal('linear'), angle: z.number().min(-360).max(360), stops: z.array(stop).min(2).max(6) }),
  z.object({ kind: z.literal('radial'), cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), r: z.number().min(0.05).max(2), stops: z.array(stop).min(2).max(6) }),
]);
export type Paint = z.infer<typeof paintSchema>;
export type PaintStop = z.infer<typeof stop>;

export const solid = (color: string): Paint => ({ kind: 'solid', color });

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

/** What a layer stands for: lets the plan swap a day's offer in, the pipeline re-check words, and the panels find things. */
export const LAYER_ROLES = ['headline', 'subline', 'offer', 'date', 'cta', 'brand', 'logo', 'photo', 'qr', 'qrLabel', 'contact', 'character', 'decor', 'custom'] as const;
export type LayerRole = (typeof LAYER_ROLES)[number];

export const ICON_KEYS = [
  'phone', 'whatsapp', 'website', 'link', 'email', 'address', 'hours', 'instagram', 'facebook', 'youtube', 'reddit', 'x', 'linkedin', 'telegram',
  'star', 'heart', 'sparkle', 'gift', 'tag', 'cake', 'cup', 'bag', 'truck', 'check', 'fire', 'percent', 'calendar', 'arrow',
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const SHAPE_KINDS = ['rect', 'ellipse', 'blob', 'burst', 'arch', 'ribbon', 'wave', 'triangle', 'star', 'ring', 'dots', 'line', 'squiggle', 'halftone'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const MASKS = ['none', 'rounded', 'circle', 'arch', 'blob', 'squircle', 'diamond', 'hexagon', 'ticket'] as const;
export type MaskKind = (typeof MASKS)[number];

export const BADGE_SHAPES = ['burst', 'circle', 'ribbon', 'tag', 'pill', 'stamp', 'flag'] as const;
export type BadgeShape = (typeof BADGE_SHAPES)[number];

const shadowSchema = z.object({ color: hex, alpha: z.number().min(0).max(1), blur: z.number().min(0).max(120), dx: z.number().min(-200).max(200), dy: z.number().min(-200).max(200) });
export type Shadow = z.infer<typeof shadowSchema>;
const strokeSchema = z.object({ color: hex, width: z.number().min(0).max(80) });

const base = {
  id: z.string().min(1).max(40),
  name: z.string().max(60),
  role: z.enum(LAYER_ROLES).optional(),
  x: z.number().min(-20000).max(20000),
  y: z.number().min(-20000).max(20000),
  w: z.number().min(1).max(20000),
  h: z.number().min(1).max(20000),
  rot: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
};

export const textLayerSchema = z.object({
  ...base,
  kind: z.literal('text'),
  text: z.string().max(600),
  font: z.string().min(1).max(40),
  weight: z.number().int().min(100).max(900),
  size: z.number().min(6).max(900),
  lineHeight: z.number().min(0.6).max(3),
  /** Letter spacing in em/1000. */
  tracking: z.number().min(-200).max(1000),
  align: z.enum(['left', 'center', 'right']),
  /** Vertical placement of the lines inside the box. */
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  fill: paintSchema,
  upper: z.boolean().optional(),
  italic: z.boolean().optional(),
  /** Shrink the size until the words fit the box (the box height stays as the owner set it). */
  autoFit: z.boolean().optional(),
  shadow: shadowSchema.optional(),
  stroke: strokeSchema.optional(),
  /** A highlight behind the words: one box, or one per line. */
  bg: z.object({ color: hex, alpha: z.number().min(0).max(1).optional(), padX: z.number().min(0).max(200), padY: z.number().min(0).max(200), radius: z.number().min(0).max(400), mode: z.enum(['box', 'lines']) }).optional(),
});
export type TextLayer = z.infer<typeof textLayerSchema>;

export const imageLayerSchema = z.object({
  ...base,
  kind: z.literal('image'),
  /** Our own file route (/api/files/...) or a data: URI made in the browser (e.g. a cut-out). */
  src: z.string().min(1).max(3_000_000),
  /** Natural size of the picture (for cropping). */
  natW: z.number().min(1).max(20000),
  natH: z.number().min(1).max(20000),
  fit: z.enum(['cover', 'contain']),
  /** Crop focus (0..1) and zoom (1 = just covers the box). */
  fx: z.number().min(0).max(1),
  fy: z.number().min(0).max(1),
  zoom: z.number().min(1).max(5),
  mask: z.enum(MASKS),
  radius: z.number().min(0).max(1000),
  flipX: z.boolean().optional(),
  border: strokeSchema.optional(),
  shadow: shadowSchema.optional(),
  /** Fade an edge into whatever is below, so a photo melts into the poster. */
  fade: z.object({ side: z.enum(['bottom', 'top', 'left', 'right', 'radial']), size: z.number().min(0.05).max(1) }).optional(),
  /** Colour the photo with a brand colour (duotone keeps the shading; wash lays a see-through colour on top). */
  tint: z.object({ color: hex, amount: z.number().min(0).max(1), mode: z.enum(['duotone', 'wash']) }).optional(),
  adjust: z.object({ brightness: z.number().min(-1).max(1), contrast: z.number().min(-1).max(1), saturation: z.number().min(-1).max(1), warmth: z.number().min(-1).max(1), blur: z.number().min(0).max(40).optional() }).optional(),
  /** A sticker-style outline around a cut-out (only visible on pictures with a transparent background). */
  outline: strokeSchema.optional(),
  /** Which kind of picture this is (the panels use it). */
  asset: z.enum(['photo', 'logo', 'upload', 'cutout', 'face']).optional(),
  /**
   * A realistic AI person (Brand Face): the scene always draws a small "AI" tag on the picture, in code, over everything else.
   * The tag belongs to this layer: it cannot be hidden, faded or covered without removing the picture itself.
   */
  ai: z.boolean().optional(),
  /** Library photo id, when the picture is one. */
  photoId: z.string().max(60).optional(),
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

export const shapeLayerSchema = z.object({
  ...base,
  kind: z.literal('shape'),
  shape: z.enum(SHAPE_KINDS),
  fill: paintSchema,
  stroke: strokeSchema.optional(),
  radius: z.number().min(0).max(2000).optional(),
  /** Variation for organic shapes (blob, squiggle) and point count for bursts and stars. */
  seed: z.number().int().min(0).max(100000).optional(),
  points: z.number().int().min(3).max(64).optional(),
  shadow: shadowSchema.optional(),
  blend: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']).optional(),
});
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;

export const qrLayerSchema = z.object({
  ...base,
  kind: z.literal('qr'),
  /** 'brief': the QR the owner set on the brief (filled in per post at render time); 'custom': typed here. */
  source: z.enum(['brief', 'custom']),
  data: z.string().min(1).max(900),
  fg: hex,
  bg: hex,
  /** Rounded plate behind the code. */
  plate: z.boolean(),
  radius: z.number().min(0).max(200),
});
export type QrLayer = z.infer<typeof qrLayerSchema>;

export const chipLayerSchema = z.object({
  ...base,
  kind: z.literal('chip'),
  icon: z.enum(ICON_KEYS),
  text: z.string().max(200),
  font: z.string().min(1).max(40),
  weight: z.number().int().min(100).max(900),
  size: z.number().min(6).max(300),
  color: hex,
  /** Icon disc colour. */
  accent: hex,
  /** Chip background. */
  bg: hex.optional(),
  style: z.enum(['pill', 'plain', 'outline']),
  /** Which contact this is (for the panels). */
  contact: z.string().max(30).optional(),
});
export type ChipLayer = z.infer<typeof chipLayerSchema>;

export const badgeLayerSchema = z.object({
  ...base,
  kind: z.literal('badge'),
  shape: z.enum(BADGE_SHAPES),
  fill: paintSchema,
  text: z.string().max(80),
  font: z.string().min(1).max(40),
  weight: z.number().int().min(100).max(900),
  color: hex,
  stroke: strokeSchema.optional(),
  shadow: shadowSchema.optional(),
  points: z.number().int().min(6).max(48).optional(),
});
export type BadgeLayer = z.infer<typeof badgeLayerSchema>;

export const iconLayerSchema = z.object({ ...base, kind: z.literal('icon'), icon: z.enum(ICON_KEYS), color: hex, shadow: shadowSchema.optional() });
export type IconLayer = z.infer<typeof iconLayerSchema>;

/** A drawn character (the brand's mascot): the SVG markup is made by our own code rig, never by AI. */
export const characterLayerSchema = z.object({
  ...base,
  kind: z.literal('character'),
  svg: z.string().max(400_000),
  vw: z.number().min(1),
  vh: z.number().min(1),
  flipX: z.boolean().optional(),
  shadow: shadowSchema.optional(),
});
export type CharacterLayer = z.infer<typeof characterLayerSchema>;

export const layerSchema = z.discriminatedUnion('kind', [textLayerSchema, imageLayerSchema, shapeLayerSchema, qrLayerSchema, chipLayerSchema, badgeLayerSchema, iconLayerSchema, characterLayerSchema]);
export type Layer = z.infer<typeof layerSchema>;
export type LayerKind = Layer['kind'];

export const studioDocSchema = z.object({
  v: z.literal(1),
  format: z.enum(STUDIO_FORMATS),
  width: z.number().int().min(100).max(4000),
  height: z.number().int().min(100).max(4000),
  background: paintSchema,
  layers: z.array(layerSchema).max(120),
  /** Which starting design this came from and its palette (for "shuffle colours"). */
  meta: z.object({ template: z.string().max(40), palette: z.string().max(40).optional(), fonts: z.string().max(40).optional() }),
});
export type StudioDoc = z.infer<typeof studioDocSchema>;

/** What a brief (or a plan) stores: one document per size, and which one the owner edits. */
export const studioStateSchema = z.object({
  v: z.literal(1),
  main: z.enum(STUDIO_FORMATS),
  docs: z.partialRecord(z.enum(STUDIO_FORMATS), studioDocSchema),
  /** Per-day documents of a plan, keyed by the day's date (YYYY-MM-DD), for days the owner edited on their own. */
  days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.partialRecord(z.enum(STUDIO_FORMATS), studioDocSchema)).optional(),
  updatedAt: z.string().max(40).optional(),
});
export type StudioState = z.infer<typeof studioStateSchema>;

// ---------------------------------------------------------------------------------------------
// What a design is made from (the requirement stage's output, as the studio needs it)
// ---------------------------------------------------------------------------------------------

export interface StudioContact {
  kind: 'phone' | 'whatsapp' | 'website' | 'email' | 'address' | 'hours' | 'instagram' | 'facebook' | 'youtube';
  text: string;
}

export interface StudioPhoto {
  id?: string;
  src: string;
  w: number;
  h: number;
  /** Colours found in the picture (strongest first). */
  colors?: string[];
  /** Where the subject is (0..1). */
  focus?: { x: number; y: number };
  /** The picture's own background is plain (a product shot): it can be cut out cleanly. */
  plainBackground?: boolean;
  /** A cut-out version (transparent background), when one was made. */
  cutout?: { src: string; w: number; h: number };
  description?: string;
}

export interface StudioContent {
  brandName: string;
  headline: string;
  subline: string;
  /** The big offer line, e.g. "20% OFF". Empty when the post has no offer. */
  offer: string;
  /** What the offer is on / when, e.g. "on all cakes · Monday only". */
  offerNote: string;
  cta: string;
  contacts: StudioContact[];
  /** The brief's QR (already the final text to encode for the first post). */
  qr: { data: string; label: string } | null;
  language: string;
}

export interface StudioBrand {
  colors: { primary: string; secondary: string; accent: string; background: string };
  /** Font role names from the brand kit (sans, serif, rounded, condensed, display). */
  fonts: { headline: string; body: string };
  logo: { src: string; w: number; h: number } | null;
  character: { svg: string; vw: number; vh: number } | null;
  /** The brand's approved pose-image face (illustrated, realistic AI, or the owner's own photos), when it is on for this post. */
  face?: StudioFace | null;
}

/** A Brand Face made of pose images (transparent PNGs of this brand's own files; drawn as picture layers). */
export interface StudioFace {
  name: string;
  /** A realistic AI person: its picture always carries the "AI" tag. */
  ai: boolean;
  /** The pose the starting designs use (the copy's pose hint, else wave). */
  pose: string;
  /** The poses that exist, each as our own file route (/api/files/mascots/...) with its natural size. */
  poses: Record<string, { src: string; w: number; h: number }>;
}

export interface StudioInput {
  format: StudioFormat;
  content: StudioContent;
  brand: StudioBrand;
  photo: StudioPhoto | null;
}

export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
