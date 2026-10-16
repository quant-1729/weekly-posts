// Brand characters (owner decision 2026-10-15): the Figital mascot kit's characters, drawn by ONE shared code rig
// (ported from vendor/figital-mascots/parchi-rig.js) with a per-character body, so every character has every action.
// No AI, no per-post cost. Tween keeps its own rig (src/lib/mascot) and is listed here as a choice too.
// Orchestrator-owned contract between the rig (src/lib/characters/**) and the design engine (src/lib/design/**).

/** Characters customers can choose. Laltain is left out (political symbol). Working names are not shown to customers. */
export const CHARACTER_IDS = [
  'tween',
  'parchi',
  'nudge',
  'chitthi',
  'dhaaga',
  'baton',
  'nishaan',
  'gaanth',
  'dabba',
  'disha',
  'yaadu',
  'mynu',
  'tiko',
] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** What the owner sees: the object, never the risky working name. The owner can give their face its own name. */
export const CHARACTER_LABELS: Record<CharacterId, string> = {
  tween: 'Tween',
  parchi: 'Paper slip',
  nudge: 'Sticky note',
  chitthi: 'Letter',
  dhaaga: 'Thread spool',
  baton: 'Relay baton',
  nishaan: 'Ribbon bookmark',
  gaanth: 'Cloth bundle',
  dabba: 'Tiffin box',
  disha: 'Compass',
  yaadu: 'Baby elephant',
  mynu: 'Myna bird',
  tiko: 'Capsule',
};

/** The kit's 41 actions (vendor/figital-mascots/ACTIONS.md). Posts use a still frame at the action's key time. */
export const CHARACTER_ACTIONS = [
  'idle', 'walk-right', 'walk-left', 'wave', 'point-right', 'point-left', 'point-up', 'point-down', 'talk', 'think',
  'celebrate', 'sleep', 'shrug', 'peek', 'reach', 'present', 'climb', 'perch', 'sit', 'cover', 'land', 'namaste',
  'thumbs-up', 'clap', 'nod', 'shake-no', 'surprised', 'oops', 'heart', 'check-off', 'write', 'stamp', 'search',
  'remind', 'hold-sign', 'phone', 'send', 'jump', 'run-right', 'run-left', 'loading',
] as const;
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number];

/** Brand colours the rig recolours: the character's accent parts (bands, ticks, seals); outlines stay ink navy. */
export interface CharacterColors {
  accent: string;
  accentDark: string;
  /** Optional body tint for characters whose body is a colour (sticky note, spool…); paper-like bodies ignore it. */
  body?: string;
}

/** Points in the character's own canvas (viewBox -10 0 260 260) that layouts attach things to. */
export interface CharacterAnchors {
  /** The tight box around the drawn character (no shadow). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Where the hands are in this pose (for pointing, holding, overlapping a frame edge). */
  handL: { x: number; y: number };
  handR: { x: number; y: number };
  /** Centre of the eyes (for "looking at" and bubble tails). */
  face: { x: number; y: number };
  /** The ground line under the feet (for shadows and perching). */
  feet: { x: number; y: number };
  /** hold-sign only: the blank placard area where code draws the offer text (never words from the AI). */
  sign?: { x: number; y: number; w: number; h: number };
  /** point-* only: the direction the character points, unit vector. */
  pointing?: { dx: number; dy: number };
}

export interface CharacterDrawing {
  /** SVG markup for the character (no <svg> wrapper), in the shared canvas viewBox -10 0 260 260. No text. */
  body: string;
  anchors: CharacterAnchors;
}

/** How a character takes part in a post layout (one role per design option). */
export const CHARACTER_ROLES = ['presenter', 'sign_holder', 'pointer', 'peeker', 'percher', 'celebrator', 'narrator'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

/** The action a role uses (pointer/peeker pick left/right from the layout; narrator talks). */
export const ROLE_ACTIONS: Record<CharacterRole, readonly CharacterAction[]> = {
  presenter: ['present', 'check-off', 'write', 'phone'],
  sign_holder: ['hold-sign'],
  pointer: ['point-left', 'point-right', 'point-up', 'point-down', 'remind'],
  peeker: ['peek'],
  percher: ['perch', 'sit'],
  celebrator: ['celebrate', 'namaste', 'clap', 'thumbs-up', 'heart'],
  // Reactions from docs/mascot-inspiration.md recipes (myth vs fact, "you asked", countdown, oops/sorry notices).
  narrator: ['talk', 'wave', 'think', 'nod', 'shake-no', 'surprised', 'oops'],
};
