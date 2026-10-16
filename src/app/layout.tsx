import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Devanagari, Onest } from "next/font/google";
import { s } from "@/lib/i18n/strings";
import "./globals.css";

// Onest is the app font (docs/design/11-theme-fish-style.md). It covers Latin and Cyrillic only, so Noto Sans and
// Noto Sans Devanagari stay in the fallback stack: Hindi and Arabic text still renders in a Noto face.
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  display: "swap",
});

const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  display: "swap",
});

export const metadata: Metadata = {
  title: s.appName,
  description: "Posts for your business, in your language.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#E4572E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${notoSans.variable} ${notoDevanagari.variable} h-full`}>
      <body className="min-h-full bg-cream text-ink antialiased">{children}</body>
    </html>
  );
}
