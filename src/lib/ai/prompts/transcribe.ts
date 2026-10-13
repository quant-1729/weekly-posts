// Voice note -> text (R2 setup, R4 voice input). Owned by the orchestrator.

export const TRANSCRIBE_PROMPT_VERSION = 'transcribe-v2';

// Sent with the audio part. Output is plain text, not JSON.
export const TRANSCRIBE_INSTRUCTION = `Transcribe this voice note from a small business owner in India exactly as spoken.
- Hindi spoken: write in Devanagari. English spoken: write in English. Mixed Hindi-English: write each word in the script it was spoken in (English words in English letters).
- Write spoken numbers, prices, times and quantities as digits ("दो सौ चालीस रुपये" -> "240 रुपये", "saade paanch baje" -> "5:30 baje"). Do not correct or change what was said.
- Do not translate, summarise, add punctuation-heavy formatting, or add anything not said.
- Mark parts you cannot hear clearly as [unclear].
- If there is no speech, return exactly: [no speech]
Return only the transcript.`;

// A transcript is too unclear to use when it is empty, has no speech, or more
// than this share of its words are [unclear]. Then ask the owner to retry or type
// (PRD §8: never guess facts from a bad transcript).
export const MAX_UNCLEAR_SHARE = 0.25;

export function isTranscriptUsable(t: string): boolean {
  const text = t.trim();
  if (!text || text === '[no speech]') return false;
  const words = text.split(/\s+/);
  const unclear = (text.match(/\[unclear\]/g) ?? []).length;
  return unclear / words.length <= MAX_UNCLEAR_SHARE;
}
