// Shared internals of the design engine: format geometry, safe zones, type scale, and the shapes
// themes, layouts and the renderer pass to each other. Not part of the public API (see index.ts).

import type { Box } from '@/lib/render';
import type { Weight, FaceId } from '@/lib/render/shape';
import type { BlockKey } from '@/lib/briefs/types';
import type { DesignFormat, FontChoice, ThemeId } from './types';
import type { Palette, Scheme } from './palette';

// ---------------------------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------------------------

/** tall = stories; boxy = square and 4:5 feed; wide = link preview and YouTube thumbnail; strip = website banner. */
export type Cls = 'tall' | 'boxy' | 'wide' | 'strip';

export const CLS: Record<DesignFormat, Cls> = {
  square: 'boxy',
  portrait: 'boxy',
  vertical: 'tall',
  landscape: 'wide',
  thumbnail: 'wide',
  banner: 'strip',
};

/** Where layouts put things: inside every safe zone, with room to breathe. */
export const CONTENT_BOX: Record<DesignFormat, Box> = {
  square: { x: 60, y: 60, w: 960, h: 960 },
  portrait: { x: 60, y: 60, w: 960, h: 1230 },
  vertical: { x: 64, y: 266, w: 952, h: 1300 }, // story UI: 250 px at the top, 340 px at the bottom
  landscape: { x: 52, y: 44, w: 1096, h: 542 },
  thumbnail: { x: 60, y: 48, w: 1160, h: 552 }, // keeps clear of the timestamp badge, bottom right
  banner: { x: 270, y: 40, w: 1380, h: 520 }, // the middle survives the crops websites and phones apply
};

/** The hard check: nothing important (text, QR, logo, mascot) may leave `inside` or touch an `avoid` box. */
export const SAFE_ZONES: Record<DesignFormat, { inside: Box; avoid: Box[] }> = {
  square: { inside: { x: 24, y: 24, w: 1032, h: 1032 }, avoid: [] },
  portrait: { inside: { x: 24, y: 24, w: 1032, h: 1302 }, avoid: [] },
  vertical: { inside: { x: 24, y: 250, w: 1032, h: 1330 }, avoid: [] },
  landscape: { inside: { x: 24, y: 24, w: 1152, h: 582 }, avoid: [] },
  thumbnail: { inside: { x: 24, y: 24, w: 1232, h: 672 }, avoid: [{ x: 1060, y: 610, w: 220, h: 110 }] },
  banner: { inside: { x: 240, y: 16, w: 1440, h: 568 }, avoid: [] },
};

/** The QR size rule scales with canvas width; the banner is 1920 wide but only 600 tall, so it is measured as a 1080 wide post. */
export const QR_RULE_WIDTH: Record<DesignFormat, number> = {
  square: 1080,
  portrait: 1080,
  vertical: 1080,
  landscape: 1200,
  thumbnail: 1280,
  banner: 1080,
};

// ---------------------------------------------------------------------------------------------
// Type scale (G-4 hierarchy). Sizes in px; max is where fitting starts, min is the floor.
// ---------------------------------------------------------------------------------------------

export type Role = 'headline' | 'primary' | 'offer' | 'subline' | 'secondary' | 'cta';

export interface RoleSize {
  max: number;
  min: number;
  lines: number;
}

export const TYPE_SCALE: Record<DesignFormat, Record<Role, RoleSize> & { contact: RoleSize; logo: RoleSize }> = {
  square: {
    headline: { max: 108, min: 50, lines: 3 },
    primary: { max: 58, min: 32, lines: 2 },
    offer: { max: 44, min: 28, lines: 1 },
    subline: { max: 38, min: 26, lines: 2 },
    secondary: { max: 36, min: 26, lines: 2 },
    cta: { max: 42, min: 28, lines: 1 },
    contact: { max: 34, min: 24, lines: 1 },
    logo: { max: 40, min: 24, lines: 2 },
  },
  portrait: {
    headline: { max: 116, min: 52, lines: 3 },
    primary: { max: 62, min: 34, lines: 2 },
    offer: { max: 46, min: 28, lines: 1 },
    subline: { max: 40, min: 26, lines: 2 },
    secondary: { max: 38, min: 26, lines: 2 },
    cta: { max: 44, min: 28, lines: 1 },
    contact: { max: 36, min: 24, lines: 1 },
    logo: { max: 42, min: 24, lines: 2 },
  },
  vertical: {
    headline: { max: 132, min: 58, lines: 4 },
    primary: { max: 72, min: 36, lines: 3 },
    offer: { max: 54, min: 32, lines: 2 },
    subline: { max: 46, min: 28, lines: 3 },
    secondary: { max: 44, min: 28, lines: 2 },
    cta: { max: 48, min: 32, lines: 2 },
    contact: { max: 40, min: 26, lines: 1 },
    logo: { max: 46, min: 26, lines: 2 },
  },
  landscape: {
    headline: { max: 74, min: 36, lines: 3 },
    primary: { max: 40, min: 24, lines: 2 },
    offer: { max: 32, min: 22, lines: 1 },
    subline: { max: 28, min: 22, lines: 2 },
    secondary: { max: 28, min: 22, lines: 2 },
    cta: { max: 30, min: 22, lines: 1 },
    contact: { max: 27, min: 20, lines: 1 },
    logo: { max: 32, min: 22, lines: 2 },
  },
  thumbnail: {
    headline: { max: 150, min: 44, lines: 3 },
    primary: { max: 64, min: 34, lines: 2 },
    offer: { max: 48, min: 28, lines: 1 },
    subline: { max: 34, min: 24, lines: 2 },
    secondary: { max: 34, min: 24, lines: 2 },
    cta: { max: 42, min: 28, lines: 1 },
    contact: { max: 30, min: 20, lines: 1 },
    logo: { max: 36, min: 24, lines: 2 },
  },
  banner: {
    headline: { max: 86, min: 40, lines: 3 },
    primary: { max: 46, min: 26, lines: 2 },
    offer: { max: 36, min: 24, lines: 1 },
    subline: { max: 30, min: 22, lines: 2 },
    secondary: { max: 30, min: 22, lines: 2 },
    cta: { max: 34, min: 24, lines: 1 },
    contact: { max: 30, min: 22, lines: 1 },
    logo: { max: 34, min: 22, lines: 2 },
  },
};

/** Thumbnails are headline-led: extra lines (subline, secondary) are shown only while the headline keeps this share of its maximum size. */
export const HEADLINE_LED_MIN: Partial<Record<DesignFormat, number>> = { thumbnail: 0.85 };

/** Share of the thumbnail width the text takes; the rest is photo or art. */
export const THUMB_TEXT_SHARE = 0.6;

/** Header (logo row) height by class. */
export const HEADER_H: Record<Cls, number> = { tall: 128, boxy: 100, wide: 76, strip: 76 };
export const LOGO_W: Record<Cls, number> = { tall: 440, boxy: 380, wide: 330, strip: 360 };
/** Mascot box (header, right side) when the mascot is on; only boxy and tall formats have a mascot slot. */
export const MASCOT_PX: Record<DesignFormat, number> = { square: 150, portrait: 190, vertical: 260, landscape: 0, thumbnail: 0, banner: 0 };

// ---------------------------------------------------------------------------------------------
// Themes, recipes (one recipe = one layout family, drawn for any format) and plans
// ---------------------------------------------------------------------------------------------

export type Arch = 'plain' | 'card' | 'band' | 'photoSplit' | 'photoFull' | 'photoCard';
export type Edge = 'straight' | 'diag' | 'wave' | 'arch';
export type DecoName =
  | 'circles'
  | 'accentBar'
  | 'softCircle'
  | 'blobs'
  | 'confetti'
  | 'sparkles'
  | 'festiveBorder'
  | 'localBorder'
  | 'diagStripes'
  | 'thinFrame'
  | 'darkGlow'
  | 'leaves'
  | 'dotGrid'
  | 'rules';

export interface Recipe {
  id: string;
  name: string;
  arch: Arch;
  align: 'left' | 'center';
  edge?: Edge;
  /** Overrides the theme's default scheme for this recipe. */
  schemes?: Partial<{ light: Scheme; dark: Scheme }>;
  /** Fill of the band/card/split panel. */
  panel?: 'solid' | 'surface' | 'bg';
  border?: 'thin' | 'thick' | 'double' | null;
  deco: DecoName[];
}

export interface ThemeStyle {
  headWeight: Weight;
  bodyWeight: Weight;
  upper: boolean;
  headScale: number;
  lineHeight: number;
  /** px corner radius when the kit says rounded; 0 when sharp. */
  radius: number;
  cta: 'pill' | 'rect' | 'arrow';
  offer: 'tag' | 'plain' | 'ribbon';
  bullet: 'dot' | 'check' | 'diamond' | 'spark' | 'leaf' | 'dash';
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  blurb: string;
  fonts: { headline: FontChoice; body: FontChoice };
  schemes: { light: Scheme; dark: Scheme };
  style: ThemeStyle;
  /** Layout families: the first is the theme's signature; photo ones are used only when there is a photo. */
  recipes: Recipe[];
  neighbours: ThemeId[];
}

export type Layer = { kind: 'svg'; svg: string } | { kind: 'photo'; frame: Box } | { kind: 'texture' };

export interface TextZone {
  box: Box;
  align: 'left' | 'center';
  valign: 'top' | 'center' | 'bottom';
  bgs: string[];
}
export interface ContactZone {
  box: Box;
  cols: number;
  align: 'left' | 'center';
  bgs: string[];
}
export interface QrZone {
  /** Top-left of the tile; its size comes from the context. */
  x: number;
  y: number;
  bgs: string[];
}
export interface LogoZone {
  box: Box;
  bgs: string[];
  /** Over a photo or busy ground: put the logo on a light plate. */
  plate: boolean;
}
export interface MascotZone {
  box: Box;
  bubble: { box: Box; tail: { x: number; y: number } } | null;
  /** A colour, or 'photo' when the mascot stands on the photo. */
  behind: string;
}

export interface Plan {
  layers: Layer[];
  text: TextZone;
  contacts: ContactZone | null;
  qr: QrZone | null;
  logo: LogoZone | null;
  mascot: MascotZone | null;
  marker: { box: Box; bgs: string[] } | null;
  photoFrame: Box | null;
}

export interface QrTile {
  text: string;
  label: string;
  payment?: { address: string; payeeName: string };
  modules: number;
  modulePx: number;
  qrPx: number;
  pad: number;
  w: number;
  h: number;
  /** Text lines under the code: [label, payee?, address?] with their sizes, fitted to the tile width. */
  lines: { text: string; size: number; weight: Weight }[];
}

export interface PlanCtx {
  format: DesignFormat;
  W: number;
  H: number;
  cls: Cls;
  cb: Box;
  pal: Palette;
  th: ThemeDef;
  recipe: Recipe;
  rtl: boolean;
  /** The layout wants the owner photo (and there is one). */
  photo: boolean;
  showLogo: boolean;
  qr: QrTile | null;
  nBlocks: number;
  mascot: boolean;
  marker: boolean;
  texture: boolean;
  radius: number;
  /** Last resort: accept text zones below the usual minimum (the renderer then reports what does not fit). */
  relaxed?: boolean;
}

export interface Faces {
  head: FaceId;
  body: FaceId;
}

export interface DesignBlockLine {
  kind: BlockKey;
  text: string;
}

export const rr = (n: number) => Math.round(n * 100) / 100;
export const inset = (b: Box, d: number, dy = d): Box => ({ x: b.x + d, y: b.y + dy, w: b.w - 2 * d, h: b.h - 2 * dy });
export const boxRight = (b: Box) => b.x + b.w;
export const boxBottom = (b: Box) => b.y + b.h;
