// CH-2: a character as a part of the post layout, not a sticker. A role (presenter, sign holder, pointer, peeker, percher,
// celebrator, narrator) says how the character takes part; the planner (plan.ts) reserves its zone, this file draws it:
// the rig's still frame (src/lib/characters) or an approved pose image, scaled to the zone, the offer or headline on the
// sign it holds and the headline in the speech bubble it narrates with (text drawn by code in the brand's fonts).
// Pure code: no AI call. The character is never filtered, and it carries no text of its own.

import { drawCharacter, ROLE_ACTIONS, type CharacterAction, type CharacterColors, type CharacterDrawing, type CharacterRole } from '@/lib/characters';
import { fitText, type Box, type FitResult } from '@/lib/render';
import { baselineOffset } from '@/lib/render/layout';
import { shapeText, shapedToSvg } from '@/lib/render/shape';
import type { FacePose } from '@/lib/faces/types';
import { chooseFill, chooseInk, mix } from './colors';
import { CLS, SAFE_ZONES, TYPE_SCALE, rr, type CharSpec, type CharZone } from './core';
import { faceImageDrawing } from './face-layer';
import { inkCandidates, type Palette } from './palette';
import type { Placed, StyleCtx } from './scene';
import type { CharacterSource, DesignContent, DesignFormat } from './types';

// ---------------------------------------------------------------------------------------------
// Which roles a source and a format can take
// ---------------------------------------------------------------------------------------------

/** The pose image a face that is drawn from images uses for a role. Peek, perch and hold-sign need the rig. */
export const IMAGE_POSE: Partial<Record<CharacterRole, FacePose>> = { presenter: 'present', pointer: 'point', narrator: 'talk', celebrator: 'celebrate' };

/** Roles that need a panel top edge to sit on or hide behind. */
export const EDGE_ROLES: readonly CharacterRole[] = ['peeker', 'percher'];
/** Roles that stand in the free corner of a wide format (no stage above a text panel there). */
const WIDE_ROLES: readonly CharacterRole[] = ['presenter', 'sign_holder', 'pointer', 'celebrator'];

/** Whether a kind of source (the rig, or pose images) can take a role in a format. */
export function roleSupportedBy(role: CharacterRole, kind: CharacterSource['kind'], format: DesignFormat): boolean {
  if (kind === 'image' && !IMAGE_POSE[role]) return false;
  const cls = CLS[format];
  return !((cls === 'wide' || cls === 'strip') && !WIDE_ROLES.includes(role));
}

export function roleSupported(role: CharacterRole, source: CharacterSource | null | undefined, format: DesignFormat): boolean {
  if (!source) return false;
  if (source.kind === 'image' && !(source.images[IMAGE_POSE[role] ?? 'wave'] ?? source.images.wave)) return false;
  return roleSupportedBy(role, source.kind, format);
}

/** The roles a kind of source can take in a format, in the order options prefer them. */
export function rolesFor(kind: CharacterSource['kind'], format: DesignFormat): CharacterRole[] {
  const all: CharacterRole[] = ['presenter', 'sign_holder', 'pointer', 'celebrator', 'narrator', 'peeker', 'percher'];
  return all.filter((r) => roleSupportedBy(r, kind, format));
}

// ---------------------------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------------------------

/**
 * Scale bands (docs/mascot-inspiration.md B1): character height over canvas height. Lead 40-55%, support 25-40%, accent 12-25%.
 * A story uses the bands of its safe area, not of the full canvas.
 */
export type Band = 'lead' | 'support' | 'accent';
export const BAND_RANGE: Record<Band, { min: number; max: number }> = { lead: { min: 0.4, max: 0.55 }, support: { min: 0.25, max: 0.4 }, accent: { min: 0.12, max: 0.25 } };
export const ROLE_BAND: Record<CharacterRole, Band> = { celebrator: 'lead', sign_holder: 'lead', presenter: 'support', pointer: 'support', narrator: 'support', peeker: 'accent', percher: 'accent' };

/** Fractions to try, biggest first: when the text does not fit, the character drops to the next size (and band) before the type shrinks. */
const STEPS: Record<Band, readonly number[]> = { lead: [0.44, 0.34, 0.22], support: [0.34, 0.27, 0.2], accent: [0.22, 0.17, 0.13] };
/** The owner's photo is the focal point (rank 1): a lead character steps down to the support band. */
const STEPS_WITH_PHOTO: Record<Band, readonly number[]> = { ...STEPS, lead: [0.34, 0.27, 0.2] };
export const CHAR_STEPS = 3;

/** The canvas height the bands are measured on: the safe area of a story (platform UI covers the top and the bottom), else the canvas. */
export const bandHeight = (format: DesignFormat, H: number): number => (format === 'vertical' ? SAFE_ZONES.vertical.inside.h : H);

export function charFraction(role: CharacterRole, photo: boolean, step: number, band?: Band): number {
  const list = (photo ? STEPS_WITH_PHOTO : STEPS)[band ?? ROLE_BAND[role]];
  return list[Math.min(step, list.length - 1)];
}

export function charTargetH(role: CharacterRole, format: DesignFormat, H: number, o: { photo?: boolean; step?: number; band?: Band } = {}): number {
  return Math.round(bandHeight(format, H) * charFraction(role, !!o.photo, o.step ?? 0, o.band));
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

const DEFAULT_ACTION: Record<CharacterRole, CharacterAction> = {
  presenter: 'present',
  sign_holder: 'hold-sign',
  pointer: 'point-left',
  peeker: 'peek',
  percher: 'perch',
  celebrator: 'celebrate',
  narrator: 'talk',
};

/**
 * The action for a role. The copy's pose is only a hint: it picks among the actions the role may use (ROLE_ACTIONS), never the role.
 * Idle, loading and sleep are not in any role's list: they do not read at 200 px.
 */
export function actionFor(role: CharacterRole, hint: string | undefined, seed: number, point?: CharacterAction): CharacterAction {
  const allowed = ROLE_ACTIONS[role];
  if (role === 'pointer') return point && allowed.includes(point) ? point : hint === 'remind' ? 'remind' : DEFAULT_ACTION.pointer;
  if (role === 'celebrator') {
    const pool: CharacterAction[] = ['celebrate', 'namaste', 'clap'];
    const hinted = hint === 'celebrate' || hint === 'namaste' || hint === 'clap' || hint === 'heart' ? (hint as CharacterAction) : null;
    return hinted ?? pool[seed % pool.length];
  }
  const hinted = allowed.find((a) => a === hint);
  return hinted ?? DEFAULT_ACTION[role];
}

/** Which way a pointing character points to reach a target from its hand: left/right when the target is more sideways, else up/down. */
export function pointAction(from: { x: number; y: number }, to: { x: number; y: number }): CharacterAction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) > 1.25 * Math.abs(dx)) return dy > 0 ? 'point-down' : 'point-up';
  return dx < 0 ? 'point-left' : 'point-right';
}

export const colorsFor = (pal: Palette): CharacterColors => {
  const accent = pal.accents[0] ?? pal.solid;
  return { accent, accentDark: mix(accent, '#000000', 0.4) };
};

export interface Drawn {
  drawing: CharacterDrawing;
  action: string;
}

/** One still frame of the character for a role. Pose images ignore colours and mirroring (a person is never flipped). */
export function drawRole(source: CharacterSource, role: CharacterRole, o: { colors: CharacterColors; mirror: boolean; hint?: string; seed: number; point?: CharacterAction }): Drawn {
  if (source.kind === 'rig') {
    const action = actionFor(role, o.hint, o.seed, o.point);
    return { drawing: drawCharacter(source.id, action, o.colors, { mirror: o.mirror }), action };
  }
  const pose = IMAGE_POSE[role] ?? 'wave';
  const img = source.images[pose] ?? source.images.wave;
  if (!img) throw new Error(`No pose image for ${role}`);
  return { drawing: faceImageDrawing(img.uri, img.w, img.h, { aiTag: source.aiTag }), action: pose };
}

// ---------------------------------------------------------------------------------------------
// Planning input: the aspect of the character decides how wide a zone to reserve
// ---------------------------------------------------------------------------------------------

/** Wide poses (arms out, a sign, confetti) reach a little past the probe's bounds: reserve this much more width. */
const WIDTH_MARGIN = 1.1;

/** Role, size and side of the character before layouts are planned (null when the role does not apply to this format). */
export function planCharacter(args: { role: CharacterRole; source: CharacterSource; format: DesignFormat; H: number; seed: number; rtl: boolean; photo?: boolean; step?: number; side?: 'left' | 'right'; band?: Band }): CharSpec | null {
  const { role, source, format, H, seed } = args;
  if (!roleSupported(role, source, format)) return null;
  const h = charTargetH(role, format, H, { photo: args.photo, step: args.step, band: args.band });
  const anchors = drawRole(source, role, { colors: { accent: '#888888', accentDark: '#444444' }, mirror: false, seed }).drawing.anchors;
  const probe = anchors.bounds;
  const w = Math.round((probe.w / probe.h) * h * WIDTH_MARGIN);
  // The rig's feet anchor of a perching pose is the seat: what hangs below it is the legs over the edge.
  const seat = role === 'percher' ? Math.min(0.95, Math.max(0.7, (anchors.feet.y - probe.y) / probe.h)) : 1;
  // The side is the brand's habit (its seed); the layouts check it fits and the plan is mirrored for right-to-left.
  const wide = CLS[format] === 'wide' || CLS[format] === 'strip';
  const side: 'left' | 'right' = wide ? 'right' : (args.side ?? (seed % 3 === 0 ? 'left' : 'right'));
  return { role, h, w, side, seat };
}

// ---------------------------------------------------------------------------------------------
// Fitting a drawing into its zone
// ---------------------------------------------------------------------------------------------

export interface Transform {
  k: number;
  tx: number;
  ty: number;
}

/** Scale the drawing so its bounds are `h` tall, centred on `cx` with the bottom of the bounds at `bottom`. */
export function fitDrawing(d: CharacterDrawing, h: number, cx: number, bottom: number): Transform {
  const b = d.anchors.bounds;
  const k = h / b.h;
  return { k, tx: cx - k * (b.x + b.w / 2), ty: bottom - k * (b.y + b.h) };
}

export const toCanvas = (t: Transform, p: { x: number; y: number }) => ({ x: t.tx + t.k * p.x, y: t.ty + t.k * p.y });
export const boxToCanvas = (t: Transform, b: Box): Box => ({ x: t.tx + t.k * b.x, y: t.ty + t.k * b.y, w: t.k * b.w, h: t.k * b.h });

// ---------------------------------------------------------------------------------------------
// The text a character carries: the sign (offer line or headline) and the narrator's bubble (headline)
// ---------------------------------------------------------------------------------------------

export type SignKey = 'offer' | 'headline';

/** The text on a sign: the brief's offer line, else the headline (copy the guardrail already checked). Never invented. */
export function signTextFor(content: DesignContent): { key: SignKey; text: string } | null {
  const offer = content.offerLine?.trim();
  if (offer) return { key: 'offer', text: offer };
  const head = content.headline.trim();
  return head ? { key: 'headline', text: head } : null;
}

export interface TextOnShape {
  box: Box;
  text: string;
  fit: FitResult;
  fill: string;
  ink: string;
  key: SignKey;
}

const SIGN_FILL = '#fffdf6';

/** Fit the sign's text into the placard: the largest size that wraps inside it, never below the readable minimum. */
export function fitSign(sign: Box, text: string, key: SignKey, sc: StyleCtx): TextOnShape | null {
  if (sign.w < 90 || sign.h < 40) return null;
  const T = TYPE_SCALE[sc.format];
  const padX = Math.max(8, sign.w * 0.07);
  const padY = Math.max(6, sign.h * 0.08);
  const upper = sc.th.style.upper && key === 'offer' ? text.toLocaleUpperCase() : text;
  const fit = fitText(upper, { weight: 800, boxW: sign.w - 2 * padX, boxH: sign.h - 2 * padY, maxSize: Math.round(T.offer.max * 1.25), minSize: Math.round(T.offer.min * 0.85), maxLines: 4, lineHeight: 1.18, dir: sc.dir, face: sc.faces.head, balance: true });
  const ink = chooseInk([SIGN_FILL], [sc.pal.kit.primary, sc.pal.dark]).ink;
  return { box: sign, text: upper, fit, fill: SIGN_FILL, ink, key };
}

/** The narrator's bubble: the headline, fitted in the bubble's box. */
export function fitBubble(box: Box, text: string, sc: StyleCtx): TextOnShape | null {
  if (box.w < 200 || box.h < 110) return null;
  const T = TYPE_SCALE[sc.format];
  const padX = 30;
  const padY = 22;
  const upper = sc.th.style.upper ? text.toLocaleUpperCase() : text;
  const fit = fitText(upper, { weight: sc.th.style.headWeight, boxW: box.w - 2 * padX, boxH: box.h - 2 * padY, maxSize: Math.round(T.headline.max * sc.th.style.headScale), minSize: T.headline.min, maxLines: T.headline.lines, lineHeight: sc.th.style.lineHeight, dir: sc.dir, face: sc.faces.head, balance: true });
  const ink = chooseInk(['#ffffff'], [sc.pal.kit.primary, ...inkCandidates(sc.pal, '#ffffff', false)]).ink;
  return { box, text: upper, fit, fill: '#ffffff', ink, key: 'headline' };
}

function textLines(t: TextOnShape, sc: StyleCtx, weight: number, face: StyleCtx['faces']['head'], padY: number, name: string): { svg: string; placed: Placed } {
  const { fit, box } = t;
  const total = fit.lines.length * fit.lineHeightPx;
  let y = box.y + padY + Math.max(0, (box.h - 2 * padY - total) / 2);
  const base = baselineOffset(weight as 700, fit.size, fit.lineHeightPx);
  const lineBoxes: Box[] = [];
  let svg = '';
  for (const l of fit.lines) {
    const x = box.x + (box.w - l.width) / 2;
    lineBoxes.push({ x, y, w: l.width, h: fit.lineHeightPx });
    svg += shapedToSvg(shapeText(l.text, weight as 700, sc.dir, face), x, y + base, fit.size, t.ink);
    y += fit.lineHeightPx;
  }
  const x0 = Math.min(...lineBoxes.map((b) => b.x));
  const x1 = Math.max(...lineBoxes.map((b) => b.x + b.w));
  const union: Box = lineBoxes.length ? { x: x0, y: lineBoxes[0].y, w: x1 - x0, h: lineBoxes.length * fit.lineHeightPx } : { x: box.x, y: box.y, w: 0, h: 0 };
  return { svg, placed: { name, kind: 'text', box: union, lines: lineBoxes, size: fit.size, weight: weight as 700, ink: t.ink, bgs: [t.fill], text: t.text, truncated: fit.truncated } };
}

// ---------------------------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------------------------

export interface CharLayout {
  zone: CharZone;
  action: string;
  drawing: CharacterDrawing;
  tf: Transform;
  /** The drawn character's tight box on the canvas. */
  box: Box;
  sign: TextOnShape | null;
  bubble: TextOnShape | null;
  /** Where the character points, when it does (canvas coordinates). */
  pointAt: { x: number; y: number } | null;
}

/** Everything about the character that is decided when a plan is evaluated and drawn: geometry, the pointing action, the texts it carries. */
export function layoutCharacter(args: { zone: CharZone; source: CharacterSource; sc: StyleCtx; content: DesignContent; seed: number; hint?: string; target: Box | null }): CharLayout {
  const { zone, source, sc, content, seed, hint } = args;
  // A directional action (pointing) already says which way it faces; the others reach and look the way the rig draws them (to the right),
  // so a character on the right is mirrored to face the middle of the post.
  const mirror = zone.side === 'right' && zone.role !== 'pointer';
  const colors = colorsFor(sc.pal);
  const cx = zone.box.x + zone.box.w / 2;
  const bottom = zone.box.y + zone.box.h;
  let drawn: Drawn;
  let pointAt: { x: number; y: number } | null = null;
  if (zone.role === 'pointer' && args.target) {
    // First a probe pointing toward the middle of the post, to see where the hand is; then the pointing the geometry asks for.
    const t = args.target;
    const probeAct: CharacterAction = zone.side === 'right' ? 'point-left' : 'point-right';
    const probe = drawRole(source, 'pointer', { colors, mirror: false, hint, seed, point: probeAct });
    const t0 = fitDrawing(probe.drawing, zone.box.h, cx, bottom);
    const hands = [probe.drawing.anchors.handL, probe.drawing.anchors.handR];
    const hand = toCanvas(t0, hands.reduce((a, h) => ((probeAct === 'point-left' ? h.x < a.x : h.x > a.x) ? h : a)));
    const near = { x: Math.min(Math.max(hand.x, t.x), t.x + t.w), y: Math.min(Math.max(hand.y, t.y), t.y + t.h) };
    pointAt = near.x === hand.x && near.y === hand.y ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : near;
    drawn = drawRole(source, 'pointer', { colors, mirror: false, hint, seed, point: pointAction(hand, pointAt) });
  } else {
    drawn = drawRole(source, zone.role, { colors, mirror, hint, seed });
  }
  const tf = fitDrawing(drawn.drawing, zone.box.h, cx, bottom);
  const box = boxToCanvas(tf, drawn.drawing.anchors.bounds);
  let sign: TextOnShape | null = null;
  const anchors = drawn.drawing.anchors;
  if (zone.role === 'sign_holder' && anchors.sign) {
    const st = signTextFor(content);
    if (st) sign = fitSign(boxToCanvas(tf, anchors.sign), st.text, st.key, sc);
  }
  const bubble = zone.role === 'narrator' && zone.bubble && content.headline.trim() ? fitBubble(zone.bubble.box, content.headline.trim(), sc) : null;
  return { zone, action: drawn.action, drawing: drawn.drawing, tf, box, sign, bubble, pointAt };
}

export interface CharDraw {
  svg: string;
  placed: Placed[];
}

/** The character group, the sign's text on its placard and the narrator's bubble with the headline. */
export function drawCharLayout(l: CharLayout, sc: StyleCtx): CharDraw {
  const { zone, tf } = l;
  let svg = '';
  const placed: Placed[] = [];
  if (zone.ledge) {
    const fill = chooseFill([sc.pal.bg], [sc.pal.solid, ...sc.pal.accents], 1.4) ?? sc.pal.solid;
    const e = zone.ledge;
    svg += `<rect x="${rr(e.x)}" y="${rr(e.y)}" width="${rr(e.w)}" height="${rr(e.h)}" rx="${rr(e.h / 2)}" fill="${fill}"/>`;
  }
  if (l.bubble && zone.bubble) {
    const b = zone.bubble.box;
    // The tail ends at the head, on the side nearest the bubble (the bubble sits on the side of the face away from the edge).
    const face = toCanvas(tf, l.drawing.anchors.face);
    const toRight = face.x > b.x + b.w / 2;
    const tail = { x: face.x + (toRight ? -1 : 1) * l.box.w * 0.26, y: face.y + l.box.h * 0.03 };
    // The tail leaves the bubble's edge nearest the character and ends at its face.
    const ex = toRight ? b.x + b.w : b.x;
    const ey = Math.min(Math.max(tail.y, b.y + 34), b.y + b.h - 34);
    svg += `<rect x="${rr(b.x)}" y="${rr(b.y)}" width="${rr(b.w)}" height="${rr(b.h)}" rx="${rr(Math.min(34, sc.radius * 1.4 + 14))}" fill="#ffffff" stroke="#111111" stroke-opacity="0.14" stroke-width="3"/>`;
    svg += `<path d="M${rr(ex)} ${rr(ey - 22)} L${rr(tail.x)} ${rr(tail.y)} L${rr(ex)} ${rr(ey + 22)} Z" fill="#ffffff" stroke="#111111" stroke-opacity="0.14" stroke-width="3" stroke-linejoin="round"/>`;
    svg += `<rect x="${rr(ex - (toRight ? 5 : 3))}" y="${rr(ey - 20)}" width="8" height="40" fill="#ffffff"/>`;
  }
  svg += `<g transform="translate(${rr(tf.tx)} ${rr(tf.ty)}) scale(${Math.round(tf.k * 10000) / 10000})">${l.drawing.body}</g>`;
  placed.push({ name: 'character', kind: 'mascot', box: clipBox(l.box, zone), lines: [clipBox(l.box, zone)], size: 0, truncated: false });
  if (l.sign) {
    const s = l.sign;
    svg += `<rect x="${rr(s.box.x)}" y="${rr(s.box.y)}" width="${rr(s.box.w)}" height="${rr(s.box.h)}" rx="${rr(Math.min(12, s.box.h * 0.12))}" fill="${s.fill}"/>`;
    const t = textLines(s, sc, 800, sc.faces.head, Math.max(6, s.box.h * 0.08), 'sign');
    svg += t.svg;
    placed.push(t.placed);
  }
  if (l.bubble) {
    const t = textLines(l.bubble, sc, sc.th.style.headWeight, sc.faces.head, 22, 'headline');
    svg += t.svg;
    placed.push(t.placed);
  }
  return { svg, placed };
}

/** What a viewer sees of the character: a peeker's lower part is behind the panel. */
function clipBox(b: Box, z: CharZone): Box {
  if (!z.behind) return b;
  const bottom = Math.min(b.y + b.h, z.floorY);
  return { x: b.x, y: b.y, w: b.w, h: Math.max(0, bottom - b.y) };
}
