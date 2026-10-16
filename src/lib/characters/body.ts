// What the shared rig needs to know about a character's body (CH-1). One definition per character lives in
// bodies/<id>.ts: the body art, the shoulder and hip points, where the face sits, and which fills take the brand colours.

import { normaliseHex, parseHex, toHex } from '@/lib/render/color';
import type { CharacterAction, CharacterColors, CharacterId } from './types';
import type { Pt } from './util';

/** Colours the bodies draw with: the brand colours (recoloured parts), shades of them, and the kit's fixed colours. */
export interface Palette {
  /** Brand accent: bands, ticks, seals, and the whole body of the teal characters. */
  accent: string;
  accentDark: string;
  accentLight: string;
  /** The body colour of characters whose body is a colour (sticky note, baton, elephant, myna). */
  body: string;
  bodyDark: string;
  bodyLight: string;
  bodyLine: string;
  /** Fixed kit colours: outlines and limbs stay ink navy, the paper stays paper. */
  navy: string;
  paper: string;
  edge: string;
  line: string;
  gold: string;
  goldDark: string;
  blush: string;
  fold: string;
  white: string;
}

/** A body's own colours, used when the brand gives none for `body`. */
export interface BodyDefaults {
  body: string;
  bodyDark: string;
  bodyLight: string;
  bodyLine: string;
}

export const KIT = {
  navy: '#17253b',
  paper: '#FFFDF6',
  edge: '#D9E2EE',
  line: '#C3D0DF',
  gold: '#F2B33D',
  goldDark: '#C98A1B',
  blush: '#F7A8A0',
  fold: '#EEF2F7',
  white: '#ffffff',
  /** The kit's own accent, so the default palette reproduces the kit exactly. */
  teal: '#2BB5B0',
  tealDark: '#1A8C88',
  tealLight: '#E3F6F5',
} as const;

function mixHex(a: string, b: string, k: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k });
}

export const shade = (hex: string, k: number): string => mixHex(hex, '#000000', k);
export const tint = (hex: string, k: number): string => mixHex(hex, '#ffffff', k);

export function buildPalette(colors: CharacterColors, d: BodyDefaults): Palette {
  const accent = normaliseHex(colors.accent, KIT.teal);
  const accentDark = normaliseHex(colors.accentDark, KIT.tealDark);
  const isKitTeal = accent.toLowerCase() === KIT.teal.toLowerCase();
  const own = colors.body ? normaliseHex(colors.body, d.body) : null;
  return {
    accent,
    accentDark,
    accentLight: isKitTeal ? KIT.tealLight : tint(accent, 0.87),
    body: own ?? d.body,
    bodyDark: own ? shade(own, 0.1) : d.bodyDark,
    bodyLight: own ? tint(own, 0.45) : d.bodyLight,
    bodyLine: own ? shade(own, 0.16) : d.bodyLine,
    navy: KIT.navy,
    paper: KIT.paper,
    edge: KIT.edge,
    line: KIT.line,
    gold: KIT.gold,
    goldDark: KIT.goldDark,
    blush: KIT.blush,
    fold: KIT.fold,
    white: KIT.white,
  };
}

/** The pose values the rig computes for an action at time t (a port of the kit's pose()). */
export interface Pose {
  action: CharacterAction;
  t: number;
  /** Upper and fore arm angles in degrees (left arm, right arm). Overridden by `ikL` / `ikR` when set. */
  L: [number, number];
  Rt: [number, number];
  legL: number;
  legR: number;
  dx: number;
  dy: number;
  tilt: number;
  sx: number;
  sy: number;
  skew: number;
  eyes: 'open' | 'happy' | 'wide' | 'sleep' | 'wink' | 'worried' | 'think';
  mouth: 'smile' | 'grin' | 'open' | 'wavy' | 'small' | 'talk';
  look: [number, number];
  /** The checklist: 1 = ticked. */
  rows: [number, number, number];
  stamp: number;
  props: string[];
  flip: boolean;
  /** Perching: legs a little longer and hanging. */
  sit: boolean;
  perch: boolean;
  pen: boolean;
  slip: boolean;
  extra: string[];
  write: number | null;
  plane: 'hand' | number | null;
  heartK: number;
  cover: boolean;
  coverPeek: boolean;
  /** Show the three-row checklist (check-off, write, stamp). Bodies without checklist rows show a small card. */
  ledger: boolean;
  /** Offset that puts the body on the ground (sit) or on the seat line (perch). */
  baseY: number;
}

/** What a body's drawing function gets. */
export interface BodyCtx {
  P: Palette;
  p: Pose;
  /** A unique-per-character id for clip paths and gradients. */
  id: string;
}

export interface BodyArt {
  /** Drawn first, inside the squash group, before the face. */
  art: string;
  /** Drawn after the face, still inside the squash group (a trunk, a beak). */
  after?: string;
}

export interface FaceSpec {
  /** 'oval': navy ovals with a highlight. 'round': a white eye with a pupil. */
  style: 'oval' | 'round';
  eyes: readonly [Pt, Pt];
  /** oval: scale relative to the kit's Parchi eyes (1 = rx 5.8, ry 7.8). round: radius of the white. */
  size: number;
  mouth: Pt;
  mouthScale: number;
  /** The mouth at rest: a line smile (the kit's default) or the filled grin. */
  smileAs?: 'smile' | 'grin';
  /** The mouth is a beak (the myna): closed at rest, open for open / grin / talk. */
  beak?: boolean;
  cheeks?: { pts: readonly [Pt, Pt]; r: number };
  /** Colour of closed-eye arcs and brows (default ink navy). */
  line?: string;
  /** Stroke width of mouths in the kit (3.4 to 3.6). */
  mouthStroke?: number;
}

export interface LegArgs {
  hx: number;
  hy: number;
  /** Degrees, positive swings the foot to +x. */
  a: number;
  len: number;
  side: -1 | 1;
  sit: boolean;
  P: Palette;
}
export interface LegOut {
  svg: string;
  /** The foot's centre, and how far the drawing extends around it (for bounds). */
  fx: number;
  fy: number;
  padX: number;
  padY: number;
}

export interface ArmGeom {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  hx: number;
  hy: number;
}

export interface LimbSpec {
  width: number;
  color: (P: Palette) => string;
  /** Hand radius; `handBig` when the hands cover the eyes. */
  hand: number;
  handBig: number;
  handFill?: (P: Palette) => string;
  handStroke?: (P: Palette) => string;
  /** The arm is a rigid wing of this length: the hand sits at its tip, in the direction of the target. */
  wingLen?: number;
  drawWing?: (a: ArmGeom, angleDeg: number, P: Palette) => string;
}

export interface CharacterBody {
  id: Exclude<CharacterId, 'tween'>;
  defaults: BodyDefaults;
  /** Centre line and the body's lowest edge at rest (also the squash pivot and the perch seat). */
  cx: number;
  bottom: number;
  shoulders: { l: Pt; r: Pt };
  /** 1 = the kit's arm (upper 22, fore 20). Wider bodies need longer arms to reach the chest. */
  armScale: number;
  limb: LimbSpec;
  legs: {
    hips: { l: Pt; r: Pt };
    len: number;
    width?: number;
    foot: { rx: number; ry: number; dx: number };
    custom?: (a: LegArgs) => LegOut;
  };
  face: FaceSpec;
  /** The body is drawn inside a rotation (sticky note, letter). */
  rot?: { deg: number; cx: number; cy: number };
  /** Native checklist rows on the body (Parchi). */
  nativeRows?: boolean;
  /** Where a body without native rows shows its checklist card (top-left; the card is 80 x 82). Default: in front, below the mouth. */
  card?: { x: number; y: number };
  /** The hold-sign placard (x, y, w, h). */
  sign: { x: number; y: number; w: number; h: number };
  /** How far below the placard's top edge the hands grip it (default 28); short-armed bodies grip higher. */
  signGrip?: number;
  /** The soft ground shadow, for the contact sheet and for engines that want one. */
  shadow: { cy: number; rx: number };
  /** Box around the body art in the body's own coordinates (before squash), excluding limbs. */
  bbox: (ctx: BodyCtx) => readonly [number, number, number, number];
  draw: (ctx: BodyCtx) => BodyArt;
}
