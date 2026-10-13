// R2 live check: a Hindi setup voice note -> transcript -> brand profile. ~$0.01.
// Run: node --env-file=.env.local --import tsx scripts/live-check-setup.mts
// Makes the voice note with Gemini TTS (saved to test-data/audio/), then uses the
// app's own transcribe + extract path.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { aiMode, generateJson, generateText } from '../src/lib/ai/client';
import { buildSetupExtractPrompt } from '../src/lib/ai/prompts/setup';
import { TRANSCRIBE_INSTRUCTION, isTranscriptUsable } from '../src/lib/ai/prompts/transcribe';
import { setupExtractJsonSchema, setupExtractSchema } from '../src/lib/ai/schemas';

const SPOKEN =
  'नमस्ते जी, मेरी दुकान का नाम शर्मा स्वीट्स है। हम इंदौर में विजय नगर में मिठाई और नमकीन बेचते हैं। ' +
  'जलेबी दो सौ चालीस रुपये किलो है, काजू कतली आठ सौ अस्सी रुपये किलो, और समोसा बीस रुपये पीस। ' +
  'हमारे ग्राहक ज़्यादातर आसपास के परिवार और ऑफिस वाले लोग हैं। ' +
  'दुकान सुबह आठ बजे से रात दस बजे तक खुली रहती है, और दो किलोमीटर तक होम डिलीवरी भी करते हैं।';

const EXPECTED = {
  products: { जलेबी: '240', jalebi: '240', 'काजू कतली': '880', 'kaju katli': '880', समोसा: '20', samosa: '20' },
};

const WAV = 'test-data/audio/setup-hi-sharma.wav';

function wavFromPcm(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

if (aiMode() !== 'live') throw new Error('Not in live mode');

if (!existsSync(WAV)) {
  const ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || 'global' });
  const r = await ai.models.generateContent({
    model: 'gemini-3.8-flash-tts',
    contents: SPOKEN,
    config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
  });
  const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData?.data) throw new Error('TTS returned no audio');
  const raw = Buffer.from(part.inlineData.data, 'base64');
  const mime = part.inlineData.mimeType ?? '';
  const wav = mime.includes('wav') && raw.subarray(0, 4).toString() === 'RIFF'
    ? raw
    : wavFromPcm(raw, Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000));
  mkdirSync('test-data/audio', { recursive: true });
  writeFileSync(WAV, wav);
  console.log(`Made ${WAV} (${(wav.length / 1024).toFixed(0)} KB)`);
}

const t0 = Date.now();
const { text: transcript } = await generateText({
  instruction: TRANSCRIBE_INSTRUCTION,
  media: [{ mimeType: 'audio/wav', data: readFileSync(WAV) }],
});
console.log(`\nTranscript (usable=${isTranscriptUsable(transcript)}):\n${transcript}`);

const prompt = buildSetupExtractPrompt({ transcript });
const { data } = await generateJson({
  system: prompt.system, user: prompt.user,
  zodSchema: setupExtractSchema, jsonSchema: setupExtractJsonSchema, temperature: 0.2,
});
console.log(`\nProfile (${Date.now() - t0} ms for transcribe + extract):\n${JSON.stringify(data, null, 2)}`);

const checks: Array<[string, boolean]> = [
  ['business name is Sharma Sweets', /sharma\s*sweets/i.test(data.business_name)],
  ['category mentions sweet', /sweet|mithai/i.test(data.category)],
  ['city is Indore with Vijay Nagar', /indore/i.test(data.city) && /vijay\s*nagar/i.test(data.city)],
  ['3 products', data.products.length === 3],
  ...data.products.map((p): [string, boolean] => {
    const key = Object.keys(EXPECTED.products).find((k) => p.name.toLowerCase().includes(k.toLowerCase()));
    return [`price of ${p.name} = ${key ? EXPECTED.products[key as keyof typeof EXPECTED.products] : '?'}`, !!key && p.price === EXPECTED.products[key as keyof typeof EXPECTED.products]];
  }),
  ['audience mentions families/office', /famil|office/i.test(data.audience)],
  ['notes have timings and delivery', /8|आठ/.test(data.notes) && /deliver|डिलीवरी/i.test(data.notes)],
];
console.log('');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
