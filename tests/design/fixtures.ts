// Fixtures for the design engine tests: kits (good and bad palettes), content (normal, long, other
// scripts) and a seeded random brief generator for the 200-brief check (PRD v3 section 9, criterion 4).

import { rng } from '@/lib/design/colors';
import { DEFAULT_KIT, THEME_IDS, FONT_CHOICES, type BrandKit, type DesignContent, type DesignFormat, type DesignInput, type ThemeId } from '@/lib/design';
import type { BlockKey } from '@/lib/briefs/types';
import type { UspKind } from '@/lib/usps/types';

export function kit(colors: BrandKit['colors'], over: Partial<BrandKit> = {}): BrandKit {
  return { ...DEFAULT_KIT, colors, ...over };
}

export const PALETTES: Record<string, BrandKit['colors']> = {
  bakery: { primary: '#c2185b', secondary: '#f6e7c8', accent: '#f2b100', background: '#fffaf2' },
  navy: { primary: '#12355b', secondary: '#e6eef7', accent: '#ff9f1c', background: '#ffffff' },
  green: { primary: '#2e7d32', secondary: '#e8f5e9', accent: '#ffb300', background: '#f7fbf4' },
  yellowOnWhite: { primary: '#ffd400', secondary: '#ffe680', accent: '#ffcc00', background: '#ffffff' },
  navyOnBlack: { primary: '#0a1f44', secondary: '#0b0b0b', accent: '#112a5c', background: '#000000' },
  greys: { primary: '#8a8a8a', secondary: '#9a9a9a', accent: '#aaaaaa', background: '#999999' },
};

/** A drop the format rules make on purpose (FORMAT_RULES), not for lack of room. */
export const isRuleDrop = (d: string) => d.startsWith('qr: not shown') || d.startsWith('contact: not shown');

export const ALL_FORMATS: DesignFormat[] = ['square', 'portrait', 'vertical', 'landscape', 'thumbnail', 'banner'];

export const LINK_QR = { text: 'https://postmitra.example/r/ab12cd34', label: 'Scan to visit' };
export const UPI = 'upi://pay?pa=sunrise.bakery@okhdfcbank&pn=Sunrise%20Bakery&cu=INR';
export const PAY_QR = { text: UPI, label: 'Scan to pay', payment: { address: 'sunrise.bakery@okhdfcbank', payeeName: 'Sunrise Bakery' } };

export function content(over: Partial<DesignContent> = {}): DesignContent {
  return {
    headline: 'Diwali sweets, fresh every day',
    subline: 'Handmade kaju katli, ladoos and barfi',
    primary: { kind: 'discount', text: '20% off all gift boxes' },
    secondary: [
      { kind: 'delivery', text: 'Free delivery within 5 km' },
      { kind: 'quality', text: 'Made with pure ghee' },
    ],
    offerLine: 'Till Sun 20 Oct',
    cta: { kind: 'order', text: 'Order on WhatsApp' },
    blocks: [
      { kind: 'phone', text: '+91 98200 12345' },
      { kind: 'address', text: '12 MG Road, Pune' },
      { kind: 'hours', text: 'Mon-Sat 10:00-20:00' },
    ],
    qr: LINK_QR,
    bubble: 'Come taste something new!',
    ...over,
  };
}

export const LONG_USP = 'Complete home renovation with free design consultation and warranty'.slice(0, 60);

export const HINDI = {
  headline: 'दीवाली स्पेशल मिठाई ताज़ा हर दिन',
  subline: 'काजू कतली और लड्डू ₹880 किलो',
  primary: 'सभी गिफ्ट बॉक्स पर 20% की छूट',
  secondary: 'घर पर मुफ़्त डिलीवरी',
  cta: 'व्हाट्सऐप पर ऑर्डर करें',
  offer: '20 अक्टूबर तक',
  phone: '+91 98200 12345',
  address: '१२ एमजी रोड, पुणे',
  bubble: 'आइए, स्वाद चखिए!',
};

export const ARABIC = {
  headline: 'قهوة محمصة طازجة كل صباح',
  subline: 'من 9 صباحاً حتى 10 مساءً',
  primary: 'خصم 20% على جميع الطلبات',
  secondary: 'توصيل مجاني داخل المدينة',
  cta: 'اطلب عبر واتساب',
  offer: 'حتى 20 أكتوبر',
  address: 'شارع الشيخ زايد، دبي',
  bubble: 'تفضلوا بزيارتنا!',
};

export function hindiContent(): DesignContent {
  return content({
    headline: HINDI.headline,
    subline: HINDI.subline,
    primary: { kind: 'discount', text: HINDI.primary },
    secondary: [{ kind: 'delivery', text: HINDI.secondary }],
    offerLine: HINDI.offer,
    cta: { kind: 'order', text: HINDI.cta },
    blocks: [
      { kind: 'phone', text: HINDI.phone },
      { kind: 'address', text: HINDI.address },
    ],
    bubble: HINDI.bubble,
  });
}

export function arabicContent(): DesignContent {
  return content({
    headline: ARABIC.headline,
    subline: ARABIC.subline,
    primary: { kind: 'discount', text: ARABIC.primary },
    secondary: [{ kind: 'delivery', text: ARABIC.secondary }],
    offerLine: ARABIC.offer,
    cta: { kind: 'order', text: ARABIC.cta },
    blocks: [
      { kind: 'phone', text: '+971 4 123 4567' },
      { kind: 'address', text: ARABIC.address },
    ],
    bubble: ARABIC.bubble,
  });
}

export function mixedContent(): DesignContent {
  return content({
    headline: 'Diwali मिठाई 2026 — fresh हर दिन',
    subline: 'Kaju katli और ladoos, ₹880/kg',
    primary: { kind: 'discount', text: 'सभी gift boxes पर 20% off' },
    secondary: [{ kind: 'delivery', text: 'Free home delivery पूरे Pune में' }],
    cta: { kind: 'order', text: 'WhatsApp पर order करें' },
  });
}

export function input(over: Partial<DesignInput> & Pick<DesignInput, 'format' | 'themeId'>): DesignInput {
  return {
    kit: kit(PALETTES.bakery, { themeId: over.themeId }),
    brandName: 'Sunrise Sweets',
    language: 'en',
    content: content(),
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------
// Random briefs
// ---------------------------------------------------------------------------------------------

const WORDS = 'fresh daily handmade organic local premium family weekend special festival garden studio repair express bakery coffee design fitness wellness clinic kids fashion sale offer new season collection'.split(' ');
const HI_WORDS = 'ताज़ा रोज़ घर की बनी खास छूट नया मौसम दुकान सेवा मुफ़्त डिलीवरी स्वादिष्ट'.split(' ');
const AR_WORDS = 'طازج يوميا خاص خصم جديد موسم متجر خدمة مجاني توصيل لذيذ'.split(' ');
const USP_KINDS: UspKind[] = ['discount', 'price', 'quality', 'reviews', 'delivery', 'guarantee', 'experience', 'free_extra', 'custom'];
const BLOCK_KINDS: BlockKey[] = ['phone', 'whatsapp', 'website', 'email', 'address', 'hours', 'dates', 'instagram'];
const BLOCK_TEXT: Record<string, string[]> = {
  phone: ['+91 98200 12345', '+971 4 123 4567', '+1 (415) 555-0132'],
  whatsapp: ['+91 98200 12345'],
  website: ['www.sunrise-sweets.example', 'sunrise.example/menu'],
  email: ['hello@sunrise-sweets.example'],
  address: ['12 MG Road, Pune 411001', 'Shop 4, Al Wasl Road, Jumeirah 1, Dubai, UAE', '221B Baker Street'],
  hours: ['Mon-Sat 10:00-20:00', 'Open daily 9am to 10pm'],
  dates: ['Sat 19 - Sun 20 Oct'],
  instagram: ['@sunrisesweets'],
};

export interface RandomBrief {
  seed: number;
  input: DesignInput;
  lang: 'en' | 'hi' | 'ar' | 'mixed';
  hasPhoto: boolean;
}

/** A reproducible brief: random theme, format, palette, kit style, text lengths, scripts, blocks and QR. */
export function randomBrief(seed: number): RandomBrief {
  const r = rng(seed * 7919 + 13);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const hex = () => '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0');
  const palette = r() < 0.4 ? { ...pick(Object.values(PALETTES)) } : { primary: hex(), secondary: hex(), accent: hex(), background: hex() };
  const themeId: ThemeId = pick(THEME_IDS);
  const format: DesignFormat = pick(ALL_FORMATS);
  const lang = pick(['en', 'en', 'en', 'hi', 'ar', 'mixed'] as const);
  const words = (n: number, l = lang) => {
    const list = l === 'hi' ? HI_WORDS : l === 'ar' ? AR_WORDS : WORDS;
    const w = Array.from({ length: n }, () => pick(list));
    if (l === 'mixed') w[Math.floor(r() * n)] = pick(HI_WORDS);
    return w.join(' ');
  };
  const len = () => 1 + Math.floor(r() * r() * 9);
  const nSec = Math.floor(r() * 4);
  const nBlocks = Math.floor(r() * 5);
  const qrKind = r();
  const blocks = Array.from({ length: nBlocks }, () => {
    const kind = pick(BLOCK_KINDS);
    return { kind, text: pick(BLOCK_TEXT[kind]) };
  });
  const c: DesignContent = {
    headline: words(2 + Math.min(len(), 7)).slice(0, 60),
    subline: r() < 0.6 ? words(len() + 2).slice(0, 90) : '',
    primary: r() < 0.75 ? { kind: pick(USP_KINDS), text: words(2 + len()).slice(0, 60) } : null,
    secondary: Array.from({ length: nSec }, () => ({ kind: pick(USP_KINDS), text: words(2 + len()).slice(0, 60) })),
    offerLine: r() < 0.5 ? (lang === 'ar' ? 'حتى 20 أكتوبر' : lang === 'hi' ? '20 अक्टूबर तक' : 'Till Sun 20 Oct') : null,
    cta: r() < 0.85 ? { kind: 'order', text: words(1 + Math.floor(r() * 4)).slice(0, 40) } : null,
    blocks,
    qr: qrKind < 0.35 ? LINK_QR : qrKind < 0.5 ? PAY_QR : null,
    bubble: words(3),
  };
  const kitStyle = { corners: pick(['rounded', 'sharp'] as const), mode: pick(['light', 'dark'] as const), energy: pick(['calm', 'bold'] as const) };
  const fonts = r() < 0.5 ? { headline: pick(FONT_CHOICES), body: pick(FONT_CHOICES) } : { headline: 'sans' as const, body: 'sans' as const };
  const k = kit(palette, { themeId, style: kitStyle, fonts, source: r() < 0.5 ? 'owner' : 'default', textLogo: r() < 0.8 });
  const name = r() < 0.15 ? 'Sri Venkateswara Traditional Handloom Sarees and Silk Emporium Pvt Ltd' : words(2 + Math.floor(r() * 2), lang === 'ar' ? 'ar' : 'en');
  return {
    seed,
    lang,
    hasPhoto: r() < 0.4,
    input: { format, themeId, kit: k, brandName: name, language: lang === 'ar' ? 'ar' : lang === 'hi' ? 'hi' : 'en', content: c },
  };
}
