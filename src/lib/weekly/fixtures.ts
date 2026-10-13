// Offline stand-ins for the model, so the weekly pipeline runs in tests and in dev without AI
// (AI_MODE=fixture, or no credentials). Never used when the model is live.
//
// The batch has 4 posts: one tied to an occasion, one with a planted unsupported price
// (PLANTED_PRICE, which the guardrail must flag), one with no photo, one on Google Business Profile.

import type { WeeklyOccasion } from '@/lib/ai/prompts/v2-weekly';
import type { Rewrite, V2FactCheck, WeeklyBatch } from '@/lib/ai/schemas-v2';
import { addDaysIso } from '@/lib/occasions/dates';

/** A price no brand's facts contain. The fixture caption states it and the fixture fact check flags it. */
export const PLANTED_PRICE = '$17.99';

export interface FixtureContext {
  weekStart: string;
  /** Prompt photo ids (p1, p2, ...) in the order the prompt listed them. */
  photoIds: string[];
  occasions: WeeklyOccasion[];
  /** The brand's mascot is on: posts carry a speech bubble and a pose (V-25). */
  mascot?: boolean;
}

export function fixtureWeeklyBatch(ctx: FixtureContext): WeeklyBatch {
  const photo = (i: number) => ctx.photoIds[i] ?? '';
  const occasion = ctx.occasions.find((o) => !o.sensitive) ?? ctx.occasions[0];
  const day = (n: number) => addDaysIso(ctx.weekStart, n);
  // With the mascot on, the model also gives what it says and its pose. The bubble never states a price.
  const talk = (bubble: string, pose: string) => (ctx.mascot ? { bubble, pose } : {});
  return {
    posts: [
      {
        suggested_day: day(0),
        channel: 'instagram',
        caption:
          'A little behind the scenes from our workshop this week.\nEvery order is checked by hand before it leaves us.\nCome and say hello, we love meeting the people we make things for.',
        hashtags: ['#behindthescenes', '#smallbusiness', '#madewithcare', '#shoplocal', '#handmade'],
        cta: 'Send us a message to get started.',
        link: false,
        image_text: { headline: 'Behind the scenes', subline: 'Made by hand, checked with care', ...talk('Made with care!', 'happy') },
        photo_id: photo(0),
        occasion_key: '',
        fact_ids: [],
        topic: 'behind the scenes workshop',
      },
      {
        suggested_day: day(2),
        channel: 'facebook',
        caption: `Our weekend tasting box is ${PLANTED_PRICE} this week.\nPick a few favourites and share them with someone you like.\nReply here and we will set one aside for you.`,
        hashtags: ['#tastingbox', '#weekendtreat', '#shoplocal'],
        cta: 'Reply to this post to reserve yours.',
        link: true,
        image_text: { headline: 'The weekend tasting box', subline: `Only ${PLANTED_PRICE} this week`, ...talk('Come and taste!', 'point') },
        photo_id: photo(1),
        occasion_key: '',
        fact_ids: [],
        topic: 'weekend tasting box offer',
      },
      {
        suggested_day: day(3),
        channel: 'linkedin',
        caption: occasion
          ? `Wishing everyone a thoughtful ${occasion.name}.\nThank you to the customers and neighbours who make our work worthwhile.`
          : 'A short note of thanks to the customers and neighbours who make our work worthwhile.\nWe are grateful for every conversation.',
        hashtags: ['#community', '#gratitude', '#smallbusiness'],
        cta: 'Follow us for more from the team.',
        link: true,
        image_text: { headline: occasion ? occasion.name : 'Thank you', subline: 'From all of us', ...(occasion?.sensitive ? {} : talk('Thank you, all!', 'celebrate')) },
        photo_id: '',
        occasion_key: occasion ? occasion.key : '',
        fact_ids: [],
        topic: occasion ? `${occasion.name} greeting` : 'thank you note',
      },
      {
        suggested_day: day(5),
        channel: 'gbp',
        caption:
          'Visit us to see what is new in the shop this season. Our team can help you choose and answer any questions you have about what we offer.',
        hashtags: [],
        cta: 'Pop in and say hello.',
        link: true,
        image_text: { headline: 'New in the shop', subline: 'Come and take a look', ...talk('Come and say hello!', 'wave') },
        photo_id: photo(2),
        occasion_key: '',
        fact_ids: [],
        topic: 'new in the shop',
      },
    ],
  };
}

/** The fact check the fixture model would give for these posts: the planted price is unsupported. */
export function fixtureFactCheck(posts: Array<{ caption: string; cta: string; image_text: { headline: string; subline: string } }>): V2FactCheck {
  const facts: V2FactCheck['facts'] = [];
  posts.forEach((p, i) => {
    const fields = [
      ['caption', p.caption],
      ['cta', p.cta],
      ['image_text.headline', p.image_text.headline],
      ['image_text.subline', p.image_text.subline],
    ] as const;
    for (const [field, text] of fields) {
      if (text.includes(PLANTED_PRICE)) {
        facts.push({ post: i + 1, field, text: PLANTED_PRICE, kind: 'price', supported: false, fact_id: '', outcome_promise: false });
      }
    }
  });
  return { facts };
}

/**
 * The rewrite the fixture model would give: the same post with the named phrases and words
 * taken out. (A real rewrite rephrases; this only has to be a different, valid post.)
 */
export function fixtureRewrite(
  post: { caption: string; cta: string; hashtags: string[]; image_text: { headline: string; subline: string } },
  remove: { phrases: string[]; words: string[] },
): Rewrite {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const strip = (text: string) => {
    let t = text;
    for (const p of remove.phrases) t = t.replace(new RegExp(esc(p), 'giu'), '');
    for (const w of remove.words) t = t.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${esc(w)}(?![\\p{L}\\p{M}\\p{N}])`, 'giu'), '');
    return t.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').replace(/^\s+|\s+$/g, '');
  };
  const caption = strip(post.caption);
  return {
    caption: caption || 'We have something new to share with you this week.',
    hashtags: post.hashtags,
    cta: strip(post.cta) || post.cta,
    image_text: { headline: strip(post.image_text.headline), subline: strip(post.image_text.subline) },
    note: '',
  };
}
