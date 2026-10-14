// Words for QR scans on the Results page. Kept next to the feature (src/lib/i18n/strings.ts is shared
// with other tasks); move into the strings file when the v3 strings are consolidated.

export const scanCopy = {
  title: "QR code scans",
  none: "No QR code scans yet this month.",
  total: (n: number) => (n === 1 ? "Your QR codes were scanned at least once this month." : `Your QR codes were scanned at least ${n} times this month.`),
  totalLast: (n: number) => (n === 1 ? "Last month: at least 1 scan." : `Last month: at least ${n} scans.`),
  perPost: "Scans per post",
  phrase: (n: number) => (n === 1 ? "at least 1 scan" : `at least ${n} scans`),
  footnote: "Scans are counted separately from link clicks. Payment QR codes open the payment app directly, so those scans are not counted.",
} as const;
