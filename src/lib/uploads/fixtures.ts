// Sample model answers for the dev flow without AI (AI_MODE=fixture, no credentials, and all tests).
// Live mode ignores these.

import type { Screenshot, Voice } from "@/lib/ai/schemas-v2";

export interface PhotoDescription {
  description: string;
  has_people: boolean;
  usable: boolean;
}

export function describeFixture(width: number, height: number): PhotoDescription {
  const shape = width > height ? "wide" : width < height ? "tall" : "square";
  return { description: `A ${shape} photo from the business.`, has_people: false, usable: true };
}

const SAMPLE_POSTS = [
  "Fresh out of the oven this morning. Come in and say hello, the kettle is on!",
  "Thank you for a lovely week, everyone. See you on Saturday for something sweet.",
  "New on the counter today. Made by hand, made with love. Pop in and try one.",
];

/** A made-up caption, chosen from the image size so different screenshots differ. */
export function screenshotFixture(imageBytes: number): Screenshot {
  return { is_post: true, text: SAMPLE_POSTS[imageBytes % SAMPLE_POSTS.length] };
}

/** First few words of a line, trimmed of trailing punctuation, so each phrase is copied from the text. */
function openingWords(text: string, count: number): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const words = line.trim().split(/\s+/).slice(0, count).join(" ");
  return words.replace(/[\s.,!?;:]+$/, "");
}

/** Phrases come from the past posts themselves, so the verbatim check passes. */
export function voiceFixture(pastPosts: string[]): Voice {
  const phrases = pastPosts
    .map((p) => openingWords(p, 4))
    .filter((p) => p.length > 0)
    .slice(0, 5);
  return {
    voice_description: "Warm and friendly, in short sentences. Talks to customers directly and ends with a simple invitation.",
    example_phrases: [...new Set(phrases)],
    avoid_suggestions: ["corporate jargon", "!!!"],
    emoji_use: "light",
    typical_length: "short",
  };
}
