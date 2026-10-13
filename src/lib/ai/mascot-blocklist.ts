// Names a mascot must not be, be named after, or copy (R15g). Checked on the
// owner's hint (before any AI call) and on every concept the AI returns.
// Owned by the orchestrator. Extend freely; keep entries lowercase.

const RELIGIOUS = [
  'ganesh', 'ganesha', 'ganpati', 'hanuman', 'bajrang', 'krishna', 'kanha', 'shiva', 'shiv', 'mahadev', 'ram', 'rama',
  'sita', 'lakshmi', 'laxmi', 'durga', 'kali', 'saraswati', 'vishnu', 'brahma', 'parvati', 'sai baba', 'shirdi',
  'guru nanak', 'nanak', 'jesus', 'christ', 'mary', 'allah', 'prophet', 'muhammad', 'buddha', 'mahavir', 'tirthankar',
  'गणेश', 'गणपति', 'हनुमान', 'बजरंग', 'कृष्ण', 'कान्हा', 'शिव', 'महादेव', 'राम', 'सीता', 'लक्ष्मी', 'दुर्गा', 'काली',
  'सरस्वती', 'विष्णु', 'साईं', 'साई बाबा', 'गुरु नानक', 'ईसा', 'अल्लाह', 'बुद्ध', 'महावीर',
];

const POLITICAL = [
  'trump', 'biden', 'obama', 'harris', 'putin', 'zelensky', 'xi jinping', 'starmer', 'sunak', 'macron', 'trudeau', 'king charles', 'queen elizabeth', 'pope',
  'modi', 'narendra', 'gandhi', 'mahatma', 'nehru', 'rahul', 'sonia', 'kejriwal', 'yogi', 'adityanath', 'amit shah',
  'mamata', 'ambedkar', 'patel', 'indira', 'atal', 'vajpayee', 'मोदी', 'गांधी', 'नेहरू', 'केजरीवाल', 'योगी', 'अंबेडकर',
];

const CELEBRITIES = [
  'taylor swift', 'beyonce', 'beyoncé', 'rihanna', 'elon musk', 'musk', 'oprah', 'kardashian', 'messi', 'ronaldo', 'lebron', 'mr bean', 'gordon ramsay', 'drake',
  'shah rukh', 'srk', 'amitabh', 'bachchan', 'salman', 'aamir', 'akshay', 'ranveer', 'deepika', 'alia', 'katrina',
  'priyanka', 'rajinikanth', 'virat', 'kohli', 'dhoni', 'sachin', 'tendulkar', 'rohit sharma', 'neeraj chopra',
  'शाहरुख', 'अमिताभ', 'सलमान', 'विराट', 'धोनी', 'सचिन',
];

const KNOWN_MASCOTS = [
  'paddington', 'winnie', 'pooh', 'snoopy', 'garfield', 'spongebob', 'minion', 'minions', 'elmo', 'shrek', 'sonic', 'mario', 'bluey', 'pingu', 'tony the tiger', 'colonel sanders', 'michelin', 'mr peanut', 'kool-aid', 'geico', 'tweety', 'bugs bunny', 'scooby', 'pikachu', 'stitch', 'olaf',
  'amul', 'chhota bheem', 'bheem', 'motu', 'patlu', 'doraemon', 'nobita', 'shinchan', 'mickey', 'minnie', 'donald',
  'duo', 'ronald', 'mcdonald', 'doughboy', 'pillsbury', 'michelin', 'bibendum', 'maharaja', 'gattu', 'zoozoo',
  'fevicol', 'lijjat', 'nirma', 'pikachu', 'tom and jerry', 'spiderman', 'batman', 'hello kitty', 'peppa',
  'छोटा भीम', 'भीम', 'मोटू', 'पतलू', 'डोरेमोन', 'अमूल',
];

export const BLOCKLIST = [...RELIGIOUS, ...POLITICAL, ...CELEBRITIES, ...KNOWN_MASCOTS];

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Returns the blocked term found in `text`, or null. Whole-word match, plus edit
 * distance 1 for names of 5+ letters. `ignore` removes phrases first: pass the
 * business name, so "Shri Ram Sweets" or "Patel Snacks" in a hint is not a hit.
 * Check the hint and each concept's name and personality, not why_it_fits.
 */
export function findBlockedTerm(text: string, ignore: string[] = []): string | null {
  let t = text.toLowerCase().normalize('NFC');
  for (const phrase of ignore) if (phrase.trim()) t = t.split(phrase.toLowerCase().normalize('NFC')).join(' ');
  const words = t.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  for (const term of BLOCKLIST) {
    if (term.includes(' ')) {
      if (t.includes(term)) return term;
      continue;
    }
    for (const w of words) {
      if (w === term) return term;
      if (term.length >= 5 && /^[a-z]+$/.test(term) && Math.abs(w.length - term.length) <= 1 && levenshtein(w, term) <= 1) return term;
    }
  }
  return null;
}
