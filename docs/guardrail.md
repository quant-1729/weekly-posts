# Facts-only guardrail — design (T-12)

Owner: orchestrator. Requirement: PRD R8. Implementation: T-13 (builder). Test set: T-14 (`test-data/planted-facts-30.json`).

**R8:** prices, discounts, dates, timings, phone numbers and claims appear only if present in the input or brand memory. Anything else is marked for the owner to confirm before download. Health, finance and education claims get an extra warning.
**AC:** on the planted-fact test set, 100% of unsupported facts are flagged; download is blocked until the owner confirms or removes them.

## 1. Sources (the only truth)

| Source | Where |
|---|---|
| Owner input | `posts.input_text` (typed text, voice transcript, photo caption) |
| Brand memory | the brand block from `prompts/generate.ts` (`brandBlock`), incl. products, prices, notes |
| Week goal | `weekly_plans.goal_detail` + idea, when the post came from a plan idea |
| Confirmed facts | `fact_flags` entries on this post with `status: confirmed` |

Owner edits are owner input: text the owner types in the review editor is never flagged.

## 2. Two layers; flag if either flags

1. **Prevention:** the generate prompt (`FACT_RULES`, `REGULATED_RULES`) tells the model not to invent. This lowers how often flags appear; it is not relied on.
2. **Deterministic layer** (`src/lib/ai/checks.ts`, free and instant):
   - numbers not in sources;
   - phone numbers, links and emails;
   - risky phrases (urgency, superlatives, guarantees, cure…).
3. **AI layer** (`prompts/fact-check.ts`, one Gemini call per post, about $0.005 and 3-5 s):
   - lists every checkable fact with `supported`, `source_quote` and `regulated_claim`;
   - catches what code cannot: claims in words ("pure desi ghee", "most trusted"), changed meanings ("free delivery" vs "free delivery above Rs 300"), dates in words ("इस रविवार तक").

**Digits inside a phone number** are one `phone` flag, not extra `price` flags: drop number issues whose digits fall inside a contact match in the same field.

**Merge rule:** `flags = deterministic issues ∪ AI facts with supported=false`.
- The AI layer can never clear a deterministic flag.
- Two flags are the same flag when they are in the same channel and field and their text spans overlap; keep one (prefer the AI span, which is shorter).
- If the AI `text` is not an exact substring of the field, keep the flag anyway (it still blocks) and mark it `highlight: false`.

## 3. Number words (deterministic layer fix)

Owners speak prices in words. The transcribe prompt (v2) writes spoken numbers as digits, but owner-typed text and outputs may still hold either form. Before comparing numbers, normalise **both sources and output** with a `numberWords` module (`src/lib/guardrail/number-words.ts`):
- **Hindi (Devanagari):** एक … निन्यानवे (1-99 are irregular, so use a full table), सौ, हज़ार/हजार, लाख, करोड़; डेढ़ = 1.5, ढाई = 2.5, सवा X = X + 0.25, साढ़े X = X + 0.5, पौने X = X − 0.25.
  - Examples: "दो सौ चालीस" = 240, "डेढ़ सौ" = 150, "ढाई हज़ार" = 2500.
- **Hinglish:** ek, do, teen, char/chaar, paanch, … bees, tees, chalees, pachaas, saath, sattar, assi, nabbe, sau, hazaar/hajar, lakh; dedh, dhai, sava, saadhe.
- **English:** one … ninety-nine, hundred, thousand, lakh, crore.
- Output: the source text with each recognised number phrase replaced by digits (keep the original too), so `numbersIn()` sees both.
- Unit tests: every example above plus 20 more, including mixed forms like "2 सौ".

## 4. Flags

Stored in `outputs.fact_flags` (jsonb array), one entry per flag:

```json
{ "id": "f_abc123", "text": "₹220", "kind": "price", "field": "caption",
  "layer": "code|ai|both", "regulated": false, "highlight": true,
  "status": "open|confirmed|removed", "decided_at": null }
```

**Lifecycle:**
- **open:** the default. It blocks download and share for that output.
- **confirmed:** the owner taps "This is true". The text becomes a confirmed fact (a source) for this post's later checks.
- **removed:** the owner taps "Remove". Code deletes the span from the field (and tidies double spaces and punctuation), and the image re-renders if the text was on it. Or the owner edits the text so the span is gone; on save, the flag becomes `removed` automatically.
- **Regulated** (`regulated: true`, or the brand's category is regulated and the kind is `claim`): the confirm sheet shows an extra warning, in plain words:
  > "Health, money and education claims can break advertising rules. Only confirm if it is true and you can prove it."
  - Confirming then needs an extra tick.

**Blocking:** download, "share to WhatsApp" and approval-link sending are disabled for an output while any of its flags is `open`. The server enforces this too: the download route returns 409 with the open flags.

## 5. When checks run

| Event | Deterministic | AI fact-check |
|---|---|---|
| Generate (all 4 outputs) | yes | yes, one call for all 4 |
| Regenerate one output | yes | yes, that output only |
| Language switch | yes | yes, that output only; confirmed facts carry over as sources |
| Owner edit | no (owner text is a source) | no |
| Template change | no | no |

Order inside generate:
1. Generate.
2. Run the deterministic checks.
3. Retry on wrong_script or too_long (as in T-5).
4. Run the AI fact-check.
5. Merge the flags.
6. Store the outputs.
7. Render.

The fact-check fits inside the 60-second R4 budget (measured generate was 3-12 s).

**AI failures:** if the fact-check call fails or returns invalid JSON twice, mark every number, phone and risky phrase as flagged (the deterministic layer is still there), add one flag "Facts not checked — please review before sharing", and log it. Never silently pass.

## 6. Evaluation (T-13 done-when)

Script `scripts/eval-guardrail.mts` runs both layers on `test-data/planted-facts-30.json`.
- **Recall:** every `planted` item is flagged, meaning its text overlaps a flag in the same field. Target 100%.
- **False positives:** flags on `allowed` spans and on the 3 clean cases. Target ≤ 1 across the set. Report these; they are owner friction, not a safety failure.
- **Cost estimate:** 30 calls × ~$0.004 ≈ $0.12, under the $0.50 approval line. Recorded in `test-data/results/guardrail-eval.json`.

---

# v2 addendum (2026-10-13): weekly posts (Req 11-13)

The two-layer design above stays as it is: flag if either layer flags, never auto-approve, and fail safe. What changes for v2:

| Topic | v2 rule |
|---|---|
| Sources | Active `brand_facts` rows (each with an id and a source), plus texts the owner confirmed on this post. Owner edits are owner input and are never flagged. There is no "owner input" per post, because posts are generated weekly. |
| AI layer | `prompts/v2-fact-check.ts` with `v2FactCheckSchema`: one call per weekly batch (all posts), and one per post after a rewrite. Statements carry `fact_id` and `outcome_promise`. |
| Deterministic layer | `checks.ts` numbers, contacts and risky phrases, with sources = fact values and labels, after number-word normalisation (§3 above). Currency symbols must match: £4.50 vs $4.50 is a flag (compare amount and currency together where a symbol is present). |
| Regulated (Req 12) | Group from `regulatedGroup(what_they_sell)`, overridden by `brand_memory.regulated`. Prompt rules per group. Any statement with `outcome_promise: true` is ALWAYS flagged for a regulated brand, even when a fact supports it (the website may say "pain-free guaranteed"; posts must not). Facts with `outcome_promise = true` are passed to generation as NEVER USE. Every regulated post shows a fixed reminder: "Check your local advertising rules before posting." |
| Words to avoid (Req 13) | A case-insensitive whole-word match on caption, CTA and image text, after Unicode normalisation. A match blocks the post until it is edited (flag kind `avoid`). |
| Repetition (Req 13, AC: no 6+ word phrase from the previous 4 weeks) | Tokenise with `\p{L}\p{M}\p{N}` (keep combining marks, so Devanagari matras stay inside words), lowercased and NFC-normalised. Remove fact values (case-insensitive) from both the candidate and the history before making 6-word shingles. History = captions of the brand's posts with `week_start` within the previous 28 days (any status except `skipped`), plus the other posts in the same batch. A hit triggers one regeneration of that post with the phrase named; if it still repeats, flag kind `repeat`. |
| Link | `link` comes from the channel (`V2_CHANNEL_SPECS.clickableLink`), not from the model. |
| Flag storage | `posts.fact_flags` (same entry shape as §4) with `field` among caption, cta, image_text.headline and image_text.subline. Kinds add `avoid`, `repeat` and `regulated_reminder` (the last is informational and never blocks). |
| Blocking | Approve (email link and dashboard), Share and Download are disabled while any blocking flag is open, and the server enforces it. |
| Evaluation | `test-data/v2/guardrail/planted-30.json` (AC 11: 100% flagged), `regulated-20.json` (AC 12: 0 unflagged promises), `repetition.json` (AC 13: all repeats caught, fact text exempt, nothing older than 4 weeks). |
