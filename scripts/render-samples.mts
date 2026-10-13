// Renderer samples (T-7, V-11).
// Run: npx tsx scripts/render-samples.mts
// Output:
//   test-results/render/samples-v2/<template>-<lang>-<photo|nophoto>.png   every template x English/Hindi/Arabic x with/without photo
//   test-results/render/samples-v2/sheet-<format>.png                       one contact sheet per format
//   test-results/render/devanagari-sheet.png, arabic-sheet.png              shaping contact sheets
//   test-results/render/samples-v2/formats/                                 renderPostFormats output for a few seeds

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp, { type OverlayOptions } from 'sharp';
import { SAMPLE_MASCOT_SVG, sampleLogo, samplePhoto } from '../src/lib/render/fixtures';
import {
  FORMATS,
  FORMAT_SIZE,
  STORY_SAFE,
  initShaping,
  listTemplates,
  renderPostDetailed,
  renderPostFormats,
  type Format,
  type PostText,
} from '../src/lib/render/index';
import { measureText, textToSvg } from '../src/lib/render/shape';

await initShaping();

const outDir = 'test-results/render';
const samplesDir = path.join(outDir, 'samples-v2');
const formatsDir = path.join(samplesDir, 'formats');
mkdirSync(formatsDir, { recursive: true });

const brand = { name: 'Sharma Sweets', colors: { primary: '#7a1f2b', secondary: '#f6e7c8', accent: '#f2b100' } };

const TEXTS: Record<string, PostText> = {
  english: {
    headline: 'Fresh roasted coffee, every morning',
    subline: 'Open daily 9am to 10pm',
    cta: 'Order on WhatsApp',
    bubble: 'Come and taste!',
  },
  hindi: {
    headline: 'दीवाली स्पेशल मिठाई',
    subline: 'काजू कतली ₹880 किलो',
    cta: 'ऑर्डर के लिए WhatsApp करें',
    bubble: 'आइए, स्वाद चखिए!',
  },
  arabic: {
    headline: 'قهوة محمصة طازجة كل صباح',
    subline: 'من 9 صباحاً حتى 10 مساءً في Sunrise Bakery',
    cta: 'اطلب عبر واتساب',
    bubble: 'تفضلوا بزيارتنا!',
  },
};

const photo = await samplePhoto();
const logo = await sampleLogo();
const times: number[] = [];

// ---- every template x language x (photo, no photo) ----
const cells: Record<Format, { template: string; lang: string; photo: boolean; file: string }[]> = { square: [], vertical: [], landscape: [] };
for (const format of FORMATS) {
  for (const t of listTemplates(format)) {
    for (const [lang, text] of Object.entries(TEXTS)) {
      for (const withPhoto of [true, false]) {
        const t0 = performance.now();
        const r = await renderPostDetailed({
          format,
          templateId: t.id,
          brand: { ...brand, logo },
          photo: withPhoto ? photo : undefined,
          text,
          mascot: format === 'landscape' ? null : { svg: SAMPLE_MASCOT_SVG },
        });
        times.push(performance.now() - t0);
        const file = path.join(samplesDir, `${t.id}-${lang}-${withPhoto ? 'photo' : `nophoto${r.fellBack ? '-as-' + r.templateId : ''}`}.png`);
        writeFileSync(file, r.png);
        cells[format].push({ template: t.id, lang, photo: withPhoto, file });
      }
    }
  }
}
console.log(`samples: ${times.length} renders, mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);

// ---- one contact sheet per format: rows = templates, columns = language x (photo, no photo) ----
const THUMB_W: Record<Format, number> = { square: 270, vertical: 270, landscape: 300 };
for (const format of FORMATS) {
  const { w, h } = FORMAT_SIZE[format];
  const tw = THUMB_W[format];
  const th = Math.round((tw * h) / w);
  const gap = 8;
  const templates = listTemplates(format).map((t) => t.id);
  const columns = Object.keys(TEXTS).flatMap((lang) => [true, false].map((p) => ({ lang, photo: p })));
  const layers: OverlayOptions[] = [];
  for (let row = 0; row < templates.length; row++) {
    for (let col = 0; col < columns.length; col++) {
      const cell = cells[format].find((c) => c.template === templates[row] && c.lang === columns[col].lang && c.photo === columns[col].photo)!;
      let img = sharp(cell.file).resize(tw, th);
      if (format === 'vertical') {
        // Story safe zones: text and logo must stay between the red lines.
        const y1 = Math.round((STORY_SAFE.top * th) / h);
        const y2 = Math.round(((h - STORY_SAFE.bottom) * th) / h);
        const lines = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><rect x="0" y="${y1}" width="${tw}" height="1" fill="#ff0000"/><rect x="0" y="${y2}" width="${tw}" height="1" fill="#ff0000"/></svg>`;
        img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(lines) }]);
      }
      layers.push({ input: await img.png().toBuffer(), left: gap + col * (tw + gap), top: gap + row * (th + gap) });
    }
  }
  const sheetW = gap + columns.length * (tw + gap);
  const sheetH = gap + templates.length * (th + gap);
  const sheet = path.join(samplesDir, `sheet-${format}.png`);
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#d9d9d9' } }).composite(layers).png().toFile(sheet);
  console.log('wrote', sheet, `${sheetW}x${sheetH}`, '(rows:', templates.join(', '), '; columns: english/hindi/arabic x photo/no photo)');
}

// ---- renderPostFormats: three posts with different seeds, with and without a photo ----
const fmtTimes: number[] = [];
for (const [i, withPhoto] of [[0, true], [1, true], [2, true], [0, false], [1, false]] as [number, boolean][]) {
  const t0 = performance.now();
  const r = await renderPostFormats({
    brand: { ...brand, logo },
    photo: withPhoto ? photo : undefined,
    text: TEXTS.english,
    mascot: { svg: SAMPLE_MASCOT_SVG },
    seed: i,
  });
  fmtTimes.push(performance.now() - t0);
  for (const f of FORMATS) writeFileSync(path.join(formatsDir, `seed${i}-${withPhoto ? 'photo' : 'nophoto'}-${f}.png`), r[f]);
}
console.log(`renderPostFormats: ${fmtTimes.length} posts x 3 formats, mean ${(fmtTimes.reduce((a, b) => a + b, 0) / fmtTimes.length).toFixed(0)} ms, max ${Math.max(...fmtTimes).toFixed(0)} ms`);

// ---- stress: long text in every template, with the mascot ----
const long: PostText = {
  headline: 'हमारी दुकान पर रोज़ सुबह ताज़ा और शुद्ध मिठाइयाँ बनती हैं, आइए',
  subline: 'आज सुबह 9 बजे से शाम 7 बजे तक सभी ग्राहकों के लिए खास छूट उपलब्ध है',
  cta: 'ऑर्डर के लिए हमें WhatsApp पर संदेश भेजें और अपनी पसंद बताएँ',
  bubble: 'आइए, आज ही स्वाद चखिए और खुश हो जाइए!',
};
const longAr: PostText = {
  headline: 'نحن نقدم لكم أفضل أنواع القهوة المحمصة طازجة كل يوم مع خدمة توصيل سريعة',
  subline: 'إلى جميع أنحاء المدينة وبأسعار مناسبة للجميع في Sunrise Bakery',
  cta: 'اطلب الآن عبر واتساب أو زرنا في أي وقت',
  bubble: 'تفضلوا بزيارتنا اليوم!',
};
for (const format of FORMATS) {
  for (const t of listTemplates(format)) {
    for (const [name, text] of [['hindi', long], ['arabic', longAr]] as const) {
      const r = await renderPostDetailed({
        format,
        templateId: t.id,
        brand: { ...brand, logo },
        photo,
        text,
        mascot: format === 'landscape' ? null : { svg: SAMPLE_MASCOT_SVG },
      });
      writeFileSync(path.join(samplesDir, `${t.id}-stress-long-${name}.png`), r.png);
    }
  }
}

// ---- Devanagari contact sheet, drawn with the same shaping and path code as the posts ----
const items: { id: string; text: string }[] = JSON.parse(readFileSync('test-data/devanagari-render.json', 'utf8'));
const SIZE = 48;
const ROW = 84;
const LABEL_W = 130;
const PAD = 24;
const maxW = Math.max(...items.map((i) => Math.max(measureText(i.text, 400, SIZE), measureText(i.text, 800, SIZE))));
const W = Math.ceil(LABEL_W + PAD * 2 + maxW);
const H = ROW * 2 * items.length + PAD;
let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
items.forEach((it, n) => {
  const y = PAD + n * ROW * 2;
  body += `<rect x="0" y="${y + ROW * 2 - 2}" width="${W}" height="2" fill="#bbb"/>`;
  body += textToSvg(it.id, 700, PAD, y + 56, 24, '#c00');
  body += textToSvg(it.text, 400, LABEL_W + PAD, y + 62, SIZE, '#000');
  body += textToSvg(it.text, 800, LABEL_W + PAD, y + ROW + 62, SIZE, '#000');
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
writeFileSync(path.join(outDir, 'devanagari-sheet.png'), new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
console.log('wrote', path.join(outDir, 'devanagari-sheet.png'), `${W}x${H}`);

// ---- Arabic contact sheet: right-aligned, regular and extra-bold, with the right edge marked ----
const arabic: { id: string; text: string; note: string }[] = JSON.parse(readFileSync('tests/render/arabic-strings.json', 'utf8'));
const AR_SIZE = 44;
const AR_ROW = 78;
const AR_LABEL_W = 330;
const AR_MAX_W = 1300; // longer strings are drawn smaller so the sheet stays a reasonable size
const arSize = (text: string) => Math.min(AR_SIZE, (AR_SIZE * AR_MAX_W) / Math.max(measureText(text, 800, AR_SIZE, 'rtl'), 1));
const AW = AR_LABEL_W + AR_MAX_W + PAD * 2;
const AH = AR_ROW * 2 * arabic.length + PAD;
let abody = `<rect width="${AW}" height="${AH}" fill="#fff"/>`;
arabic.forEach((it, n) => {
  const y = PAD + n * AR_ROW * 2;
  const right = AW - PAD;
  const size = arSize(it.text);
  abody += `<rect x="0" y="${y + AR_ROW * 2 - 2}" width="${AW}" height="2" fill="#bbb"/>`;
  abody += `<rect x="${right}" y="${y}" width="1" height="${AR_ROW * 2 - 2}" fill="#6aa5ff"/>`;
  abody += textToSvg(it.id, 700, PAD, y + 40, 24, '#c00', 'ltr');
  abody += textToSvg(it.note, 400, PAD, y + 76, 20, '#555', 'ltr');
  abody += textToSvg(it.text, 400, right - measureText(it.text, 400, size, 'rtl'), y + 56, size, '#000', 'rtl');
  abody += textToSvg(it.text, 800, right - measureText(it.text, 800, size, 'rtl'), y + AR_ROW + 56, size, '#000', 'rtl');
});
const asvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${AW}" height="${AH}" viewBox="0 0 ${AW} ${AH}">${abody}</svg>`;
writeFileSync(path.join(outDir, 'arabic-sheet.png'), new Resvg(asvg, { font: { loadSystemFonts: false } }).render().asPng());
console.log('wrote', path.join(outDir, 'arabic-sheet.png'), `${AW}x${AH}`);
