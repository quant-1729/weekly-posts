// Real and famous people a Brand Face must not be made to look like (owner rule, docs/10 section 2: no real people
// other than the consenting owner). Lowercase. The mascot blocklist (src/lib/ai/mascot-blocklist.ts) covers religious
// figures, politicians and a first set of celebrities; this adds more and is checked on the description. Extend freely.

export const FAMOUS_PEOPLE = [
  'tom cruise', 'brad pitt', 'angelina jolie', 'will smith', 'johnny depp', 'leonardo dicaprio', 'keanu reeves', 'robert downey',
  'dwayne johnson', 'ryan reynolds', 'ryan gosling', 'chris hemsworth', 'chris evans', 'scarlett johansson', 'emma watson',
  'emma stone', 'margot robbie', 'zendaya', 'timothee chalamet', 'tom hanks', 'morgan freeman', 'denzel washington', 'jackie chan',
  'kim kardashian', 'kylie jenner', 'kanye', 'jay-z', 'jay z', 'eminem', 'justin bieber', 'ariana grande', 'selena gomez', 'billie eilish',
  'ed sheeran', 'lady gaga', 'jennifer lopez', 'michael jackson', 'elvis', 'marilyn monroe', 'einstein', 'albert einstein',
  'steve jobs', 'bill gates', 'mark zuckerberg', 'jeff bezos', 'warren buffett', 'mrbeast', 'mr beast', 'pewdiepie', 'cristiano', 'neymar',
  'mbappe', 'federer', 'serena williams', 'michael jordan', 'tiger woods', 'usain bolt', 'david beckham', 'zlatan',
  'sundar pichai', 'ratan tata', 'mukesh ambani', 'kareena', 'hrithik', 'ranbir', 'prabhas', 'allu arjun', 'mahesh babu',
  'taylor swift', 'beyonce', 'rihanna', 'oprah', 'messi', 'ronaldo', 'lebron', 'shah rukh', 'amitabh', 'virat kohli', 'kohli', 'dhoni', 'tendulkar',
  'lata mangeshkar', 'kishore kumar', 'sunny leone', 'carryminati', 'bhuvan bam',
] as const;

/** Words that point at a real person's profession or fame instead of describing a character. */
export const FAME_WORDS = [
  'celebrity', 'celebrities', 'celeb', 'famous', 'film star', 'movie star', 'bollywood star', 'hollywood', 'actor', 'actress',
  'politician', 'prime minister', 'influencer', 'youtuber', 'supermodel', 'lookalike', 'look-alike', 'look alike', 'doppelganger', 'likeness',
] as const;
