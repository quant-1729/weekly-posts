// Offline stand-in for the model's rewrite (AI_MODE=fixture, or no credentials, or tests). Never
// used when the model is live. It changes the copy in a way the owner can see, and adds no facts.

import type { Rewrite } from '@/lib/ai/schemas-v2';

export type PostCopy = { caption: string; cta: string; hashtags: string[]; image_text: { headline: string; subline: string } };

export function fixtureRewriteFor(post: PostCopy, instruction: string): Rewrite {
  const lines = post.caption.split('\n').map((l) => l.trim()).filter(Boolean);
  const ask = instruction.toLowerCase();
  let caption: string;
  if (/short|less|brief|trim/.test(ask) && lines.length > 1) caption = lines.slice(0, lines.length - 1).join('\n');
  else if (/emoji/.test(ask) && lines.length > 0) caption = [`${lines[0]} \u{1F60A}`, ...lines.slice(1)].join('\n');
  else if (/friend|warm|casual/.test(ask)) caption = `Hello friends! ${post.caption}`;
  else caption = `A quick note from us. ${post.caption}`;
  return { caption, hashtags: post.hashtags, cta: post.cta, image_text: post.image_text, note: '' };
}
