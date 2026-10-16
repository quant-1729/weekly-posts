// The twelve code-drawn bodies. Tween is drawn by its own rig (../tween.ts); Laltain is not offered.

import type { CharacterBody } from '../body';
import type { CharacterId } from '../types';
import { baton } from './baton';
import { chitthi } from './chitthi';
import { dabba } from './dabba';
import { dhaaga } from './dhaaga';
import { disha } from './disha';
import { gaanth } from './gaanth';
import { mynu } from './mynu';
import { nishaan } from './nishaan';
import { nudge } from './nudge';
import { parchi } from './parchi';
import { tiko } from './tiko';
import { yaadu } from './yaadu';

export const BODIES: Record<Exclude<CharacterId, 'tween'>, CharacterBody> = {
  parchi, nudge, chitthi, dhaaga, baton, nishaan, gaanth, dabba, disha, yaadu, mynu, tiko,
};
