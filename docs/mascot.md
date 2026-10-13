# Brand mascot — design (T-17)

Owner: orchestrator. Requirement: PRD R15. Implementation: T-18 (builder). Test set: T-19 (`test-data/mascot-eligibility-20.json`).
Decision D4: the mascot is a **parametric SVG character** drawn by code (Duolingo-style). There is no image model and no AI-drawn pixels.

## R15, piece by piece

| R15 | How |
|---|---|
| (a) Eligibility | Code rules (`src/lib/ai/mascot-eligibility.ts`), using category, tone and audience. Regulated categories never get a mascot. Formal brands are not offered one by default, but can choose "Try anyway" on the Brand page. |
| (b) 3 concepts | One Gemini call (`prompts/mascot.ts`) returns 3 concepts. Each has a name, a personality, why it fits, and a **rig spec** chosen from a fixed parts catalogue. Code draws all 3 for the owner to pick from. |
| (c) Character sheet | The chosen spec is saved once (`mascots.spec`). Code draws 8 poses from that one spec, so the character never drifts. Each pose is exported as a transparent SVG and PNG, plus a 4×2 sheet PNG, to `mascots/{brand_id}/{mascot_id}/`. |
| (d) In posts | The renderer's mascot slot (400×400 space, `MASCOT_BOX`) takes the pose SVG. The speech bubble is drawn by code with HarfBuzz text (already in T-7). |
| (e) On/off, regenerate | `posts.mascot_id` is null when the mascot is off. Regenerating creates a new `mascots` row and archives the old one. Old posts keep their `mascot_id`, so they stay unchanged. |
| (f) Ownership | The mascot screen says "This mascot is yours. Download it any time." The terms page gets a clause saying the owner owns their mascot and its images. The sheet download is always available. |
| (g) Blocks | A name/hint blocklist in code, a prompt rule, a parts catalogue that can't depict a real person, and a check for parts combinations that resemble known mascots. |

## Eligibility rules (deterministic)

1. `isRegulatedCategory(category)` (health, finance, education) → **not eligible**, with no override. Mascot speech could carry claims in a regulated business.
2. **Formal** → not eligible by default, but the owner can choose "Try anyway". Formal means:
   - the category contains: law, legal, advocate, lawyer, notary, funeral, cremation, government, contractor, consultancy, real estate, property; or
   - the tone is "Premium". ("Simple and respectful" does not count: many ordinary kirana shops pick it.)
3. Otherwise → **eligible**.

Store the result in `brand_memory.mascot_eligibility` as `{ "eligible": bool, "reason": "regulated|formal|ok", "checked_at": "..." }`. Re-check it when the category or tone changes.
**Test:** all 20 brands in `test-data/mascot-eligibility-20.json` must give `expected_eligible`.

## The rig (SVG, 400×400, transparent)

The spec is JSON (`mascots.spec`). Every value comes from a closed list, so the model can only pick, never draw:

```json
{
  "v": 1,
  "body":  { "shape": "round|drop|cup|box|pear|bean", "color": "#E4572E", "pattern": "none|dots|stripes|swirl", "pattern_color": "#FFF3E0" },
  "face":  { "eyes": "dot|round|shine|sleepy", "brows": true, "cheeks": true, "mustache": "none|thin" },
  "limbs": { "style": "stick|noodle|mitten", "color": "#3A2A1A" },
  "head":  "none|topi|chef_hat|cap|headband|flower",
  "neck":  "none|scarf|bow|apron|dupatta",
  "extra": "none|specs|apron_pocket",
  "accent_color": "#1B998B"
}
```

- **Shapes mean things:**
  - round → laddoo, ball or a generic friendly blob
  - drop → samosa, flame or water
  - cup → chai or ice cream
  - box → phone, gift or shop
  - pear → kurta or vase
  - bean → a generic character
- **Colours** come from the brand palette, plus one body colour the model may choose. Code checks the contrast of eyes and limbs against the body.
- **Excluded on purpose:**
  - human skin tones and hair, so the rig can't depict a real person;
  - religious marks (tilak, cross, crescent, turban styles tied to a faith) and religious headwear;
  - political colours used as a set, such as the saffron-white-green flag combination on one body;
  - the combination `head: topi` + `mustache: thin` + `neck: bow`, which is too close to well-known Indian mascots.

### The 8 poses (keys used by templates and the generate prompt)

| Key | Arms | Face | Use |
|---|---|---|---|
| `namaste` | hands joined at chest | eyes closed, smile | greetings, festivals |
| `wave` | one arm up, waving | open smile | default |
| `happy` | arms down, slight bounce | big smile | general |
| `thumbs_up` | one mitten thumbs-up | wink | quality, new stock |
| `point` | arm pointing to the side, toward the text | open mouth | offers and prices |
| `excited` | both arms up, small jump | wide eyes and mouth | launches, sales |
| `thinking` | hand at chin | brows raised, looking up | questions and tips |
| `celebrate` | arms up with code-drawn sparkles (no religious objects) | big smile | festivals, milestones |

The same spec goes in every pose; only arms, eyes, mouth and small props change. That is what makes the same character recognisable across all 8 (R15 AC).

**Which pose a post uses:** at T-18 the generate schema gains `image_text.pose` (one of the 8 keys, or ""). The prompt picks it to match the message. Code falls back to `wave` if the pose is empty or invalid.

## Concepts prompt (`prompts/mascot.ts`)

- **Input:** business name, category, city, audience, tone, products (names only, no prices), brand colours, and an optional free-text hint from the owner.
- **Output:** `{ refused, refusal_reason, concepts: [3 × { name, name_hi, personality, why_it_fits, spec }] }`.
- **Rules:**
  - Names are short (2-8 letters), easy to say in Hindi and English, and not a real person, deity, saint, politician, celebrity, sports star or existing brand mascot.
  - The 3 concepts differ in shape and accessory.
  - Personality is one line, friendly and family-safe.
  - If the hint asks for a real person, a religious or political figure, or a copy of a known mascot, set `refused: true` with a plain reason and return no concepts.

**Code checks run before and after the call:**
- The hint and every concept name/description are checked against the **blocklist** (`src/lib/ai/mascot-blocklist.ts`), case- and script-insensitive:
  - **deities and religious figures:** Ganesh, Hanuman, Krishna, Shiva, Ram, Lakshmi, Durga, Saraswati, Sai Baba, Guru Nanak, Jesus, Mary, Allah, Prophet, Buddha, Mahavir and others
  - **political figures:** current and recent PMs, CMs and party leaders
  - **celebrities and sports stars**
  - **known mascots:** Amul girl, Chhota Bheem, Motu Patlu, Doraemon, Mickey, Duo, Ronald, Pillsbury Doughboy, Michelin Man, Maharaja (Air India), Gattu (Asian Paints), ZooZoo, Fevicol, Lijjat bunny, Nirma girl and others
  - both Latin and Devanagari spellings, plus fuzzy matching (edit distance ≤ 1 on names of 5 or more letters)
- **Hint match:** refuse before calling the AI (saves cost).
- **Concept match:** drop that concept. If fewer than 3 remain, call once more, then show what is left.
- **Not similar:** the spec must not match the excluded combinations above.
- **Speed:** 1 Gemini call (about $0.003, 4-8 s) plus 3 SVG renders, so well under the 60-second AC.

## Storage and data

| What | Where |
|---|---|
| 3 concepts | `mascots` rows with `status: concept` (spec, concept JSON) |
| Pick | the chosen one becomes `active`, the other two `discarded` |
| Sheet | 8 SVGs, 8 transparent PNGs (800×800) and a sheet PNG in `mascots/{brand_id}/{mascot_id}/`; `sheet_path` = the sheet PNG |
| Regenerate | the old active row becomes `archived`, and new concepts follow the same flow |
| Per post | `posts.mascot_id`. A new post sets it from the active mascot when the owner has the mascot switched on (a brand-level default in the create screen); it can be switched per post on review |

## Tests T-18 must have

- Eligibility gives the expected result on all 20 test brands.
- The blocklist refuses prompts naming a celebrity, a deity, a politician or a known mascot, in English and Hindi. There are at least 12 cases, all refused, with no AI call made.
- The rig draws all 8 poses for 20 random valid specs. Every SVG parses, has a 400×400 viewBox, contains no `<text>` and no `<image>`, and has a transparent background.
- **Same character:** across the 8 poses the body path and colours are identical; only limb, eye, mouth and prop groups differ.
- The mascot renders in every template (6) for 3 poses, with the bubble text inside the bubble (renderer test hook).
- Mascot off leaves `posts.mascot_id` null and no mascot in the render. Regenerating keeps old posts' `mascot_id`.
