# Design theme: "Fish-style" for Weekly Posts (draft, 2026-10-15)

The owner asked for Weekly Posts to look like the Fish Audio app: same font, text sizes, colours, shapes and spacing. These values were measured from fish.audio/app on 2026-10-15 at 1440×900, using computed styles and their CSS variables, plus the owner's screenshot of the signed-in Home page.

**What we copy and what we don't.** We copy the *visual language*: type scale, warm-neutral palette, pill shapes, card style and spacing. We do **not** copy Fish Audio's logo, name, illustrations, images, icons or wording. Weekly Posts keeps its own name, its own coral accent (#E4572E, which is close to Fish's #F56138 anyway) and its own content.

---

## 1. Fonts

| Use | Fish Audio | Weekly Posts |
|---|---|---|
| Everything in the app UI | **Onest** (variable, 100–900) | **Onest** (SIL Open Font License, on Google Fonts, free to use) |
| Occasional serif accent | Lora 400 | Lora 400, only if we want it (also open licence). Not needed in v1 |
| Code / numbers in tables | Geist Mono | Geist Mono, or `tabular-nums` on Onest |

**Fallback stack:** `"Onest", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Arabic", sans-serif`.

Onest covers Latin and Cyrillic only. Weekly Posts serves Hindi, Arabic and other scripts, so the Noto families stay in the stack and those scripts fall back to Noto automatically. Post designs keep their own Noto font rendering; this theme only changes the app screens.

## 2. Type scale (measured)

| Token | Size / line height | Weight | Colour | Where Fish uses it |
|---|---|---|---|---|
| `text-page-title` | 14 / 20 | 500 | title | Top bar page name ("Home"); small on purpose |
| `text-banner` | 20 / 28 | 700 (banner) or 500 (dialog) | title | Promo banner heading, dialog title |
| `text-section` | 18 / 26, letter-spacing 0.18px | 400 | title | Section headings ("Projects", "Tutorials") |
| `text-card-title` | 16 / 24 | 500 | title | Feature card title ("Text to Speech") |
| `text-body` | 16 / 24 | 400 | body | Default text, dialog subtitle (in description colour) |
| `text-ui` | 14 / 20 | 500 | subtitle or title | Sidebar items, buttons, form labels, quick-tool names |
| `text-desc` | 12 / 16 (3 lines max) | 400 | description | Card descriptions |
| `text-group` | 12 / 16 | 500 | helper | Sidebar group label ("Products") |
| `text-badge` | 11 / 14 | 500 | red-500 on red-50 | "New" badge |

**Overall feel:** small, medium-weight (500) UI text; headings that are calm rather than big and bold; generous whitespace.

## 3. Colours (warm neutrals)

### Base greys
These are Fish Audio's "new-gray" scale, slightly warm and brown-tinted:

| Token | Hex | Use |
|---|---|---|
| gray-99 | `#FBFAF9` | **Page background** (body, top bar, main) |
| gray-98 | `#FAF7F7` | Hover on white |
| gray-96 | `#F6F0EC` | Medium background (wells, tracks) |
| gray-94 | `#F0EAE7` | Dividers on cream |
| gray-90 | `#E5DCD9` | Borders (opaque) |
| gray-80 | `#D0C4C0` | Divider lines |
| gray-75 | `#C4B7B4` | Disabled text, disabled primary button |
| gray-60 | `#9F928E` | Helper text |
| gray-45 | `#7A6F6B` | Description text |
| gray-30 | `#554F4C` | Subtitle text, secondary nav items |
| gray-6 | `#1D1D1C` | Primary button, body text |
| gray-4 | `#161616` | Titles |
| white | `#FFFFFF` | Cards, dialogs, active tab |

### Translucent fills
Warm-tinted, transparent:

| Token | Value | Use |
|---|---|---|
| fill-active | `rgba(96,0,0,0.03)` | Active sidebar item, segmented-control track |
| fill-group | `rgba(96,0,0,0.016)` | Grouped sidebar block (Creative / Developer / Agents) |
| border-light | `rgba(96,32,0,0.063)` | Light borders (track, list rows) |
| border-input | `rgba(73,21,0,0.192)` | Input and outline-button borders |
| border-card | `rgba(0,0,0,0.05)` | Card hairline |

### Accent and status
- **Accent (Weekly Posts):** coral `#E4572E`, darker text tone `#B93A15`, tint `#FDF3EF`. Fish's own scale is coral-500 `#F56138`, coral-100 `#FDF3EF` and coral-50 `#FEF7F5`.
  - The accent is used **sparingly**: badges, focus ring, progress and selected states.
  - Primary buttons are **near-black**, not coral. That is the biggest visual change from today.

| Status | Background | Border | Text |
|---|---|---|---|
| Success | `#EBF9F6` | `#CCF0E7` | `#13725C` |
| Warning | `#FFF6E5` | `#FFE3B2` | `#C2670C` |
| Error | `#FFEFEB` | `#FDD0C6` | `#B9241C` |
| Info | `#F0F7FF` | `#CCE5FF` | `#1D7BD8` |
| "New" badge | `#FFEFEB` | none | `#F54B45` |

## 4. Shapes, borders, shadows

| Element | Radius | Border | Shadow |
|---|---|---|---|
| Cards (feature cards, panels) | **16px** | 1px `rgba(0,0,0,0.05)` | `0 1px 3px rgba(0,0,0,0.04)` |
| Large banner / hero panel | 16px | none | none |
| Dialogs | 16px | inset 0.5px `rgba(73,21,0,0.192)` | `0 12px 32px -4px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.1)` |
| Dialog overlay | none | none | none; background `rgba(0,0,0,0.6)` |
| Buttons, chips, nav items, tabs | **9999px (pill)** | none | none |
| Select / dropdown field | 24px | 1px border-input | none |
| Small toggle buttons (On/Off) | 10px | none | none |
| Sidebar group block | 20px | none | none |

## 5. Components

- **Primary button:** height 36px (40px in dialogs and full width), padding 0 16px, pill, background gray-6 `#1D1D1C`, white text 14/500.
  - Hover gray-15 `#333130`, pressed gray-20 `#3E3B3A`, disabled gray-75 `#C4B7B4`.
- **Secondary button:** pill, background `rgba(96,32,0,0.063)`, title-colour text. Hover `rgba(102,31,0,0.1)`.
- **Outline button:** pill, transparent background, 1px border-input, subtitle text.
- **Ghost / tertiary button:** transparent, subtitle text, hover fill `rgba(96,0,0,0.03)`.
- **Segmented control (tabs):**
  - track: pill, 2px padding, fill-active background, border-light;
  - active tab: white pill with `0 1px 2px rgba(0,0,0,0.05)`, title text;
  - inactive tab: gray-45 text.
- **Sidebar item:** 36px high, 8px padding, gap 8px, 20px icon, 14/500.
  - Default colour gray-30; the active item gets fill-active and title colour.
  - The sidebar is 224px wide; items are 208px with 8px side margin.
- **Sidebar group label:** 12/500 in helper colour, with 16px top spacing.
- **Feature card:**
  - white, 16px radius, hairline border, 16px padding, about 120px high;
  - title 16/500, description 12/400 in description colour;
  - illustration on the right (ours: simple code-drawn shapes, no copied art).
- **Quick-tool row:** a round icon well (40–48px circle, gray-96 fill, gray-30 icon) plus a 16–18/500 label. Five across on desktop.
- **Top bar:**
  - 52px high, page background, padding 8px 12px 8px 8px;
  - sidebar-toggle icon, then the page title (14/500);
  - on the right, round 36px icon buttons and an account pill.
- **Badges:** pill, 1px 4px padding, 11/500.
- **Inputs and textareas:** white, radius 12–16px (we use 16px to match cards), 1px border-input. Hover border `rgba(38,9,0,0.44)`, focus border gray-6 with no glow ring. Placeholder in helper colour.
- **Form label:** 14/500 title colour; helper text 12–14/400 in description colour.
- **Floating help button ("Ask Agent" style):** white pill, soft shadow, bottom-right. We'd use it for Tween ("Ask Tween").

## 6. Layout

- **Page background:** gray-99 everywhere. White is only for cards and dialogs.
- **Desktop:**
  - 224px sidebar on the left, with no border (it sits on the same cream background);
  - main area with about 24px padding;
  - content max width about 1600px;
  - card grids with 16px gaps.
- **Sidebar order (Fish):** grouped top block → main nav → "Products" group → footer upgrade pill.
- **Our sidebar:**
  - grouped top block: **Create a post**, **Queue**;
  - main: Home, Ideas (planned), Results, History;
  - a "Brand" group: Brand, Connections, Brand Face (planned);
  - footer: account and plan pill.
- **Phone (375px):** the sidebar becomes a drawer behind the top-bar toggle, plus our existing bottom nav. Cards stack in one column with 16px gutters.

## 7. Mapping from today's Tailwind classes

| Today (src/components/ui.ts) | New |
|---|---|
| `bg-[#E4572E]` primary buttons | `bg-[#1D1D1C] hover:bg-[#333130] rounded-full h-9 px-4 text-sm font-medium text-white` |
| `rounded-xl border-stone-300` inputs | `rounded-2xl border-[rgba(73,21,0,0.19)] bg-white focus:border-[#1D1D1C]` |
| `rounded-2xl border-stone-200 bg-white` cards | `rounded-2xl border-black/5 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]` |
| `bg-stone-50` page | `bg-[#FBFAF9]` |
| `text-stone-600` hints | `text-[#7A6F6B]` (description) / `text-[#9F928E]` (helper) |
| selected chip `border-[#E4572E] bg-[#E4572E]/10` | selected: `bg-[#1D1D1C] text-white` pill; or keep the coral tint for "picked" cards |
| `font-sans` (system) | Onest via `next/font/google` |

Implementation, after the owner approves the prototype:
1. Put the tokens in `globals.css` as CSS variables, plus Tailwind theme entries.
2. Swap the helpers in `src/components/ui.ts`.
3. Rework the app shell (sidebar and top bar).
4. Do a pass over every page.
5. Run the 375px check and the accessibility contrast check. Description grey `#7A6F6B` on cream is about 4.6:1, which passes AA for body text; helper grey `#9F928E` is about 2.9:1, so it is used only for non-essential text, never for labels, errors or instructions.
