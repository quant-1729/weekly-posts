// Generated test images for the renderer: a photo-like picture and logos.
// Used by tests and scripts/render-samples.mts. Not used by the app.

import sharp from 'sharp';

/** Gradient plus shapes, roughly photo-sized (default 1600x1200, JPEG). */
export async function samplePhoto(width = 1600, height = 1200): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7c873"/><stop offset="0.55" stop-color="#e2735a"/><stop offset="1" stop-color="#5a3a6e"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${width * 0.3}" cy="${height * 0.4}" r="${height * 0.22}" fill="#fff4d6" fill-opacity="0.9"/>` +
    `<circle cx="${width * 0.62}" cy="${height * 0.55}" r="${height * 0.16}" fill="#b8472f" fill-opacity="0.85"/>` +
    `<rect x="${width * 0.52}" y="${height * 0.12}" width="${width * 0.3}" height="${height * 0.2}" rx="30" fill="#2f6f5e" fill-opacity="0.8" transform="rotate(12 ${width * 0.65} ${height * 0.22})"/>` +
    `<polygon points="${width * 0.1},${height * 0.95} ${width * 0.28},${height * 0.62} ${width * 0.46},${height * 0.95}" fill="#f2f2f2" fill-opacity="0.8"/>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** Solid single-colour square PNG logo, for exact pixel checks. */
export async function solidLogo(hex: string, size = 200): Promise<Buffer> {
  const n = parseInt(hex.replace('#', ''), 16);
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } },
  })
    .png()
    .toBuffer();
}

/** A round emblem on a transparent background, for sample renders. */
export async function sampleLogo(size = 300): Promise<Buffer> {
  const c = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${c}" cy="${c}" r="${c - 4}" fill="#7a1f2b"/><circle cx="${c}" cy="${c}" r="${c * 0.62}" fill="#f2b100"/>` +
    `<polygon points="${c},${c * 0.55} ${c * 1.4},${c * 1.35} ${c * 0.6},${c * 1.35}" fill="#7a1f2b"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Placeholder mascot group in the 400x400 mascot space. */
export const SAMPLE_MASCOT_SVG =
  '<g><ellipse cx="200" cy="330" rx="110" ry="50" fill="#000" fill-opacity="0.15"/>' +
  '<circle cx="200" cy="200" r="130" fill="#ffc93c"/><circle cx="155" cy="175" r="20" fill="#222"/><circle cx="245" cy="175" r="20" fill="#222"/>' +
  '<path d="M140 240 Q200 310 260 240" stroke="#222" stroke-width="14" fill="none" stroke-linecap="round"/></g>';
