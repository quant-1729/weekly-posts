// Imagen background live check (C-18): at most 2 images (one light theme, one dark theme), each checked for text.
// Imagen is about $0.02-0.06 per image, so this stays well under $0.50.
// Run: node --env-file=.env.local --import tsx scripts/live-check-imagen.mts
// Writes test-results/imagen/*.png. If Imagen is not enabled on the project, prints the exact error and stops (no retries).
import { mkdirSync, writeFileSync } from 'node:fs';
import { aiMode } from '@/lib/ai/client';
import { generateImagenImage, imagenLocation, imagenModel } from '@/lib/ai/imagen';
import { IMAGEN_NEGATIVE, buildImagenBackgroundPrompt } from '@/lib/ai/prompts/v3';
import { geminiTextCheck } from '@/lib/style/backgrounds';

if (aiMode() !== 'live') throw new Error('Not in live mode (check .env.local: AI_MODE, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_CLOUD_PROJECT)');
mkdirSync('test-results/imagen', { recursive: true });
console.log('model:', imagenModel(), 'location:', imagenLocation());

const cases = [
  { name: 'light-fresh', themeId: 'fresh', mode: 'light' as const, colors: ['#1f4e9c', '#f59e0b', '#fff8f0'], leaveSpace: 'center' as const },
  { name: 'dark-premium', themeId: 'premium', mode: 'dark' as const, colors: ['#c53045', '#f3a900', '#1b1718'], leaveSpace: 'center' as const },
];

let total = 0;
for (const c of cases) {
  const prompt = buildImagenBackgroundPrompt({ themeId: c.themeId, colors: c.colors, mode: c.mode, leaveSpace: c.leaveSpace });
  const t = Date.now();
  try {
    const img = await generateImagenImage({ prompt, negativePrompt: IMAGEN_NEGATIVE, aspectRatio: '1:1', seed: 12345 });
    const file = `test-results/imagen/${c.name}.png`;
    writeFileSync(file, img.bytes);
    const check = await geminiTextCheck(img.bytes);
    const usd = img.usd + check.usd;
    total += usd;
    console.log(`${c.name}: ${Date.now() - t} ms, ${img.bytes.length} bytes, imagen $${img.usd.toFixed(4)} + check $${check.usd.toFixed(5)}, hasText=${check.hasText} -> ${file}`);
  } catch (e) {
    console.error(`${c.name} FAILED:`, e instanceof Error ? e.message : e);
    console.error('Stopping without retries.');
    break;
  }
}
console.log('total estimated cost: $' + total.toFixed(4));
