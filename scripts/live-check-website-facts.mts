// AC 3 live check: website-facts prompt on the V-7 test sites (~$0.02).
// Simulates the reader's page choice and HTML cleaning; V-4 builds the real reader.
// Run: node --env-file=.env.local --import tsx scripts/live-check-website-facts.mts

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { aiMode, generateJson } from '@/lib/ai/client';
import { buildWebsiteFactsPrompt, type WebsitePage } from '@/lib/ai/prompts/v2-memory';
import { websiteFactsJsonSchema, websiteFactsSchema } from '@/lib/ai/schemas-v2';

if (aiMode() !== 'live') throw new Error('Not in live mode');

const ROOT = 'test-data/v2/websites';
const PREFERRED = /^(index|about|menu|services|contact|pricing|timetable)\.html$/;

function clean(html: string): { title: string; text: string } {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&pound;/g, '£').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 8000);
  return { title, text };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9£$€₹]+/g, ' ').trim();

let allPass = true;
for (const site of ['corner-bakery', 'harbour-dental']) {
  const dir = path.join(ROOT, site);
  const disallow = readFileSync(path.join(dir, 'robots.txt'), 'utf8').match(/^Disallow:\s*(\S+)/gim)?.map((l) => l.split(/:\s*/)[1]) ?? [];
  const files = readdirSync(dir).filter((f) => PREFERRED.test(f) && !disallow.some((d) => `/${f}`.startsWith(d))).slice(0, 5);
  const pages: WebsitePage[] = files.map((f) => ({ url: `https://${site}.example/${f}`, ...clean(readFileSync(path.join(dir, f), 'utf8')) }));
  const expected: Array<{ kind: string; label: string; value: string; page: string }> = JSON.parse(readFileSync(path.join(dir, 'expected-facts.json'), 'utf8'));

  const p = buildWebsiteFactsPrompt({ businessName: site.replace('-', ' '), pages });
  const t = Date.now();
  const { data } = await generateJson({ system: p.system, user: p.user, zodSchema: websiteFactsSchema, jsonSchema: websiteFactsJsonSchema, temperature: 0, timeoutMs: 40_000, budgetMs: 60_000 });
  const ms = Date.now() - t;

  // A fact counts as found when an extracted fact's value or quote contains the expected value.
  const found = expected.filter((e) => data.facts.some((f) => norm(f.value).includes(norm(e.value)) || norm(f.quote).includes(norm(e.value)) || norm(e.value).includes(norm(f.value))));
  const missed = expected.filter((e) => !found.includes(e));
  // Precision: extracted facts whose quote is really on one of the pages.
  const pageText = pages.map((pg) => norm(pg.text)).join(' ');
  const unquoted = data.facts.filter((f) => !pageText.includes(norm(f.quote).slice(0, 60)));
  const trap = data.facts.filter((f) => /12\.50/.test(f.value));
  const outcome = data.facts.filter((f) => f.outcome_promise).map((f) => f.value);
  const recall = found.length / expected.length;
  if (recall < 0.8 || trap.length || unquoted.length > 2) allPass = false;

  console.log(`\n${site}: pages ${files.join(', ')} | ${ms} ms | extracted ${data.facts.length}`);
  console.log(`  recall ${found.length}/${expected.length} (${Math.round(recall * 100)}%) | quotes not on page: ${unquoted.length} | robots trap leaked: ${trap.length} | outcome promises: ${JSON.stringify(outcome)}`);
  for (const m of missed) console.log(`  MISSED ${m.kind}: ${m.label} = ${m.value} (${m.page})`);
  for (const u of unquoted) console.log(`  UNQUOTED ${u.kind}: ${u.value} | quote: ${u.quote.slice(0, 80)}`);
  console.log(`  summary: ${data.business_summary}`);
}
console.log(`\n${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
