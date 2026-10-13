# Image rendering (T-7, R6; V-11, Req 9 and 10)

Shaping spike result (scripts/render-spike.mts; sheets in test-results/render/spike-A.png and spike-B.png):
- Chosen: Approach A. harfbuzzjs shapes each run with the Noto TTF, glyph outlines become SVG paths, resvg rasterises. All 40 strings in test-data/devanagari-render.json are correct (conjuncts, reph, rakar, short-i matra, nukta, anusvara, chandrabindu).
- Rejected: Approach B (resvg `<text>` with fontFiles). Marks and advances are wrong on most strings (for example dv-01 ज्ञान, dv-02 शिक्षा, dv-07 शास्त्रीय, dv-09 ब्रह्मांड, dv-10 दुकान): glyphs overlap and spaces collapse.
- A also gives exact advance widths, which wrapping and shrink-to-fit in layout.ts depend on.

Files: shape.ts (fonts, bidi pass, shaping, glyph paths), layout.ts (wrap, shrink, truncate), color.ts (WCAG contrast, ink), templates.ts (12 templates), index.ts (`renderPost`, `renderPostFormats`, `listTemplates`).
`renderPost` and `renderPostFormats` initialise HarfBuzz themselves; call `await initShaping()` first when using the sync helpers (`fitText`, `shapeText`) directly.
The mascot SVG group is authored in a 400x400 space and scaled into the template's mascot slot.

## No AI imagery (Req 9, AC 9)

Decision for the MVP: there are **no AI-generated images at all**. Every background is code-drawn (flat colour, circles, rounded cards, gradients and scrims from the brand colours). The only raster inputs are the owner's own photo and logo, which are placed unchanged (cover-cropped). All text is shaped by code and drawn as paths; the SVG never contains `<text>`, and its only `<image>` elements are the photo and the logo (a test checks this for every template). Owners with no photo get the text-only templates. Do not add AI backgrounds without a new decision: they would have to stay abstract and never depict the owner's products, premises or people.

## Formats (Req 10)

| Format | Size | Used for |
|---|---|---|
| `square` | 1080 x 1080 | Instagram and Facebook feed |
| `vertical` | 1080 x 1920 | Stories and messaging status (WhatsApp, Messenger) |
| `landscape` | 1200 x 630 | LinkedIn feed and link previews; Google Business Profile crops it acceptably |

`tall` is the v1 name of `vertical`. `renderPost`, `renderPostDetailed` and `listTemplates` still accept it, and the v1 template ids (`tl-photo-top`, `tl-photo-full`, `tl-text`) are unchanged. `templateInfo(id).format` now reports `vertical`.

**Story safe zones (vertical).** App UI covers the top 250 px (profile bar) and the bottom 340 px (reply box), so headline, subline, CTA, bubble, logo and brand-name chip stay between y = 250 and y = 1580 (`STORY_SAFE`). Photos and colour bleed to the edges. Tests check every text line and logo box in every vertical template, in three languages, with and without mascot and logo.

## Templates

| Format | Photo | Text-only |
|---|---|---|
| square | `sq-photo-band`, `sq-photo-full` | `sq-text`, `sq-text-card` |
| vertical | `tl-photo-top`, `tl-photo-full` | `tl-text`, `tl-text-card` |
| landscape | `ls-photo-split` (photo left, text right), `ls-photo-full` (full-bleed with scrim, text at the bottom) | `ls-text` (shapes and text), `ls-text-card` |

A photo template with no usable photo is replaced by the first text-only template of the same format (`fellBack: true`). Each template has a logo slot (or a brand-name chip when there is no logo), brand colours, and the headline, subline and CTA pill. Square and vertical also have the mascot and bubble slots. **Landscape draws no mascot and no bubble**: it is a short business-channel frame, and a mascot given to it is ignored.

## v2 API

`renderPostFormats({ brand, photo?, text, mascot?, dir?, templates?, seed? })` returns `{ square, vertical, landscape, used }` (PNG buffers and the template used per format).
- Default template per format: a photo template when the photo decodes, else a text-only one.
- `seed` (use the post index) rotates through the templates of that kind, so a week of posts does not look the same. Same seed gives the same templates.
- `templates` forces a template per format. The photo is decoded and shrunk once (longest side 2400 px) and the logo is prepared once for the three renders.
- Timing: about 0.1 s without a photo and 0.25 to 0.4 s with a 4000x3000 photo on the dev machine (3 formats, after warm-up); a test asserts under 1.5 s.

## Scripts, fonts and right-to-left text

Fonts per run: Latin uses Noto Sans, Devanagari uses Noto Sans Devanagari, Arabic script uses Noto Sans Arabic (`assets/fonts`, licences `OFL-*.txt`). Spaces, punctuation and ASCII digits take the font of the neighbouring letters, so Hindi text keeps the v1 look. A character the chosen font lacks falls back, per run, to the first bundled font that has it. `shapeText().missing` counts .notdef glyphs.

**Direction.** The post direction is `rtl` when letters in Arabic script (or Hebrew) outnumber all other letters in headline + subline + CTA (`detectDirection`), unless `dir` is given. In an rtl post:
- Text is shaped with HarfBuzz direction `rtl` and script `Arab` (language `ar`). Brackets in rtl runs are mirrored once, by HarfBuzz (Bidi_Mirroring); the code does not mirror them itself. `(جديد)` shows as `(جديد)` with the opening bracket drawn as ")" on the right.
- Template alignment is mirrored: left-aligned text and CTA pills become right-aligned inside the same box; centred text stays centred. `ls-photo-split` swaps sides (photo right, text left). Logo and mascot slots are not mirrored.

**Mixed runs (minimal bidi pass in shape.ts `analyse`).** Each character is rtl (Arabic letters), ltr (other letters and all digits) or neutral. A neutral sequence takes its neighbours' direction when both agree, otherwise the paragraph direction. Currency signs, `%`, `+` and `-` touching a digit stay with the number (UAX #9 W5), and separators between digits (decimal, thousands, `:`, `/`) stay inside it. Runs of equal direction and font are put in visual order with the UAX #9 level reordering (L2) over levels 0, 1 and 2, so digits and Latin names read left to right inside Arabic text.

Limits:
- Not UAX #9. A number counts as ltr when resolving neutrals, so `AED 150` and `iPhone 15 Pro` stay one ltr run in the order typed (UAX #9 would show `150 AED` in an rtl paragraph unless an LRM is added).
- Phone-like sequences are one ltr run shown as typed: an optional `+` or `(`, then digits joined by spaces, dashes, dots or brackets, at least 7 digits in total (`+971 4 123 4567`, `+44 20 7946 0123`, `(020) 7946-0123`). Times and dates (`9:30`, `15/12`, `2026-12-15`) are covered by the between-digits rule. Side effect: a list of several short numbers separated only by spaces that adds up to 7 or more digits (`10 20 30 40`) is also kept in typed order.
- No explicit embeddings or isolates (LRE, RLE, LRI, RLI, ...), no full weak-type rules (ES, ET, CS beyond the affix rule), no L1 whitespace reset. LRM and RLM are honoured as direction hints.
- Every wrapped line is reordered on its own, using the direction of the whole post.
- Hebrew is detected as rtl but no Hebrew font is bundled, so it shows as missing glyphs.
- Arabic letters are not joined across a font fallback boundary (only for characters Noto Sans Arabic lacks, which are never joining letters).
- Test strings: `tests/render/arabic-strings.json` (18 strings). Review sheet: `test-results/render/arabic-sheet.png` from `npx tsx scripts/render-samples.mts`. The same script writes every template x English/Hindi/Arabic x photo/no photo to `test-results/render/samples-v2/` with one contact sheet per format.

The Next build traces `assets/fonts/**` only for routes listed in `outputFileTracingIncludes` in `next.config.ts`; any new route that renders images (the weekly pipeline, V-10) must be added there.
