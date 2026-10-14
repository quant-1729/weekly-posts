// Words for "Keep my look" and backgrounds. Kept next to the feature (src/lib/i18n/strings.ts is edited by
// other tasks); move into the strings file when the v3 strings are consolidated.

export const styleCopy = {
  noClearLook: "We couldn't find one clear look; pick a theme instead.",
  noteMainAdjusted: 'We made your main colour a little darker or lighter so it stands out on the background.',
  noteMainWeak: 'Your main colour is close to the background colour, so it may look faint. Try a theme or change a colour.',
  noteAccentAdjusted: 'We made your accent colour a little darker or lighter so it stands out on the background.',
  noteAccentWeak: 'Your accent colour is close to the background colour, so it may look faint.',
  noteTextWeak: 'Text may be hard to read on one of these colours. Check the preview.',
  coloursOnly: "We found your website colours but fewer than 3 pictures, so this look uses colours only. Connect Instagram or add photos for a fuller read.",
  nothing: "We couldn't find enough to learn from. Add your Instagram @name or website, or pick a theme instead.",

  card: {
    title: 'Keep my look',
    intro: 'We can look at your website colours and up to 12 of your own Instagram pictures and suggest colours, fonts and a theme that match. We match colours, mood and layout, not exact fonts or artwork.',
    read: 'Read my look',
    reading: 'Looking…',
    keep: 'Keep my look',
    keeping: 'Saving…',
    fresh: 'Try a fresh look',
    resultTitle: 'What we found',
    colours: 'Colours',
    theme: 'Theme',
    fonts: 'Fonts',
    headlineFont: 'headlines',
    bodyFont: 'text',
    from: 'Based on',
    fromInstagram: (n: number) => `${n} of your Instagram pictures`,
    fromWebsite: 'your website colours',
    saved: 'Saved. Your colours, fonts and theme now follow this look.',
    failed: "We couldn't read your look just now. Please try again.",
    saveFailed: "We couldn't save that. Please try again.",
    cap: "You've used this week's look reads. They reset on Monday.",
  },
} as const;

export const themeLabels: Record<string, string> = {
  classic: 'Classic',
  clean: 'Clean',
  bold_sale: 'Bold sale',
  premium: 'Premium',
  playful: 'Playful',
  festive: 'Festive',
  local: 'Local',
  minimal_dark: 'Minimal dark',
  fresh: 'Fresh',
};

export const fontLabels: Record<string, string> = {
  sans: 'Clean sans-serif',
  serif: 'Serif',
  rounded: 'Rounded',
  condensed: 'Condensed',
  display: 'Display',
};
