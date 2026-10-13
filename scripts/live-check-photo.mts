// Photo describe prompt live check (~$0.002). Run: node --env-file=.env.local --import tsx scripts/live-check-photo.mts [file]
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { aiMode, generateJson } from '@/lib/ai/client';
import { PHOTO_DESCRIBE_INSTRUCTION } from '@/lib/ai/prompts/v2-weekly';
import { photoDescribeJsonSchema, photoDescribeSchema } from '@/lib/ai/schemas-v2';
if (aiMode() !== 'live') throw new Error('Not in live mode');
const file = process.argv[2] ?? 'test-data/photos/jalebi-rs99.png';
const jpg = await sharp(readFileSync(file)).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
const t = Date.now();
const { data } = await generateJson({ system: 'You describe photos for matching. Return JSON.', user: PHOTO_DESCRIBE_INSTRUCTION, media: [{ mimeType: 'image/jpeg', data: jpg }], zodSchema: photoDescribeSchema, jsonSchema: photoDescribeJsonSchema, temperature: 0, timeoutMs: 15000, budgetMs: 25000 });
console.log(file, Date.now() - t, 'ms', data);
