// Simple code-drawn glyphs in a 24 x 24 box (generic shapes, not copies of anyone's logo artwork).
import type { IconKey } from './types';

export interface IconDef {
  label: string;
  /** stroke: drawn as 2px lines; fill: filled shapes. */
  mode: 'stroke' | 'fill';
  d: string;
  /** Extra filled dots for stroke icons. */
  dots?: [number, number, number][];
}

export const ICONS: Record<IconKey, IconDef> = {
  phone: { label: 'Phone', mode: 'stroke', d: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z' },
  whatsapp: { label: 'WhatsApp', mode: 'stroke', d: 'M4 20l1.3-4.2A8 8 0 1 1 8.2 18.7zM9 9c0 3 3 6 6 6l1-2-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2z' },
  website: { label: 'Website', mode: 'stroke', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z' },
  link: { label: 'Link', mode: 'stroke', d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  email: { label: 'Email', mode: 'stroke', d: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM4 7l8 6l8-6' },
  address: { label: 'Address', mode: 'stroke', d: 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11zM12 7.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8z' },
  hours: { label: 'Hours', mode: 'stroke', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5.5l3.5 2' },
  instagram: { label: 'Instagram', mode: 'stroke', d: 'M8.5 3.5h7a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5h-7a5 5 0 0 1-5-5v-7a5 5 0 0 1 5-5zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', dots: [[17, 7, 1.2]] },
  facebook: { label: 'Facebook', mode: 'fill', d: 'M13.5 21v-8h2.7l.4-3.2h-3.1V7.8c0-.9.3-1.5 1.6-1.5h1.7V3.4A22 22 0 0 0 14.4 3c-2.4 0-4 1.5-4 4.1v2.7H7.8V13h2.6v8z' },
  youtube: { label: 'YouTube', mode: 'fill', d: 'M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z' },
  reddit: { label: 'Reddit', mode: 'stroke', d: 'M12 9c4.4 0 8 2.2 8 5s-3.6 5-8 5s-8-2.2-8-5s3.6-5 8-5zM12 9l1.5-5l4 1M9 16c1.8 1 4.2 1 6 0', dots: [[9, 13, 1.1], [15, 13, 1.1], [18.5, 5, 1.4]] },
  x: { label: 'X', mode: 'stroke', d: 'M4 4l16 16M20 4L4 20' },
  linkedin: { label: 'LinkedIn', mode: 'stroke', d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 10v7M12 17v-4a2 2 0 0 1 4 0v4M12 10v7', dots: [[8, 7, 1.2]] },
  telegram: { label: 'Telegram', mode: 'stroke', d: 'M21 4L3 11l6 2.5L19 7l-8 8v5l3-3.5l4 3z' },
  star: { label: 'Star', mode: 'fill', d: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z' },
  heart: { label: 'Heart', mode: 'fill', d: 'M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.7 12 21 12 21z' },
  sparkle: { label: 'Sparkle', mode: 'fill', d: 'M12 1.5c.8 5.6 3 7.8 8.5 8.5c-5.5.8-7.7 3-8.5 8.5c-.8-5.5-3-7.7-8.5-8.5c5.5-.7 7.7-2.9 8.5-8.5zM19.5 15c.3 2.2 1.2 3.1 3.3 3.3c-2.1.3-3 1.2-3.3 3.3c-.3-2.1-1.2-3-3.3-3.3c2.1-.2 3-1.1 3.3-3.3z' },
  gift: { label: 'Gift', mode: 'stroke', d: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0' },
  tag: { label: 'Tag', mode: 'stroke', d: 'M3 12V4h8l10 10-8 8z', dots: [[7.5, 8.5, 1.4]] },
  cake: { label: 'Cake', mode: 'stroke', d: 'M4 20h16M5 20v-7h14v7M5 16c2 1.5 4 1.5 7 0s5-1.5 7 0M12 13V9M12 5.5c1 1 1 2.5 0 3c-1-.5-1-2 0-3z' },
  cup: { label: 'Cup', mode: 'stroke', d: 'M4 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3c-1 1 1 2 0 3M12 3c-1 1 1 2 0 3' },
  bag: { label: 'Bag', mode: 'stroke', d: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2' },
  truck: { label: 'Delivery', mode: 'stroke', d: 'M2 6h11v10H2zM13 10h4l3 3v3h-7M6.5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM16.5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4z' },
  check: { label: 'Check', mode: 'stroke', d: 'M4 12.5l5 5L20 6.5' },
  fire: { label: 'Hot', mode: 'fill', d: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6c0 2 1 3 2 3c0-3-1-6 1-9z' },
  percent: { label: 'Percent', mode: 'stroke', d: 'M19 5L5 19M7 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM17 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z' },
  calendar: { label: 'Date', mode: 'stroke', d: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 5zM3.5 10h17M8 3v4M16 3v4' },
  arrow: { label: 'Arrow', mode: 'stroke', d: 'M4 12h15M13 6l6 6-6 6' },
};

/** Which icon a contact kind uses. */
export const CONTACT_ICON: Record<string, IconKey> = {
  phone: 'phone',
  whatsapp: 'whatsapp',
  website: 'website',
  email: 'email',
  address: 'address',
  hours: 'hours',
  instagram: 'instagram',
  facebook: 'facebook',
  youtube: 'youtube',
  reddit: 'reddit',
  link: 'link',
  x: 'x',
  linkedin: 'linkedin',
  telegram: 'telegram',
};
