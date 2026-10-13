// Fixture-mode answers for review replies (tests and offline dev). They use no facts at all.

import type { ReviewReply } from '@/lib/ai/schemas-v2';

const SERIOUS = /food poisoning|poisoned|\bsick\b|vomit|\bill\b|hospital|allerg|lawyer|legal action|\bsue\b|police|racis|discriminat|harass|बीमार|ज़हर|जहर/i;
const NEGATIVE = /wait|slow|rude|cold|dirty|disappoint|expensive|overpriced|never again|worst|bad|terrible|देर|खराब/i;

export function reviewReplyFixture(review: string): ReviewReply {
  if (SERIOUS.test(review)) {
    return {
      reply: 'Thank you for telling us, and we are very sorry. This is not what we want for anyone. Please get in touch with us so we can look into it properly.',
      sentiment: 'negative',
      needs_attention: true,
      attention_reason: 'illness or safety',
    };
  }
  if (NEGATIVE.test(review)) {
    return {
      reply: 'Thank you for your feedback, and we are sorry we let you down this time. Please get in touch with us so we can put it right.',
      sentiment: 'mixed',
      needs_attention: false,
      attention_reason: '',
    };
  }
  return {
    reply: 'Thank you so much for your kind words. We are glad you enjoyed it and we would love to see you again soon.',
    sentiment: 'positive',
    needs_attention: false,
    attention_reason: '',
  };
}
