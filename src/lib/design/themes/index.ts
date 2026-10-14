// The nine themes (G-1, G-3). Each is a set of layout families (recipes) plus type, shape and palette
// preferences; the planner turns a recipe into regions for any format.

import type { ThemeDef } from '../core';
import { THEME_IDS, type ThemeId } from '../types';
import { bold_sale } from './bold-sale';
import { classic } from './classic';
import { clean } from './clean';
import { festive } from './festive';
import { fresh } from './fresh';
import { local } from './local';
import { minimal_dark } from './minimal-dark';
import { playful } from './playful';
import { premium } from './premium';

export const THEMES: Record<ThemeId, ThemeDef> = { classic, clean, bold_sale, premium, playful, festive, local, minimal_dark, fresh };

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES[id] ?? THEMES.clean;
}

export const THEME_LIST: ThemeDef[] = THEME_IDS.map((id) => THEMES[id]);
