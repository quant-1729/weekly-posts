// A real-looking "owner photo" for the engine tests: a bakery table seen from above (warm wood, a plate with
// a bun in the middle, a bowl and soft window light), with fine grain so it behaves like a camera photo
// (not flat colour blocks). The subject sits in the centre; the rest is texture.

import sharp from 'sharp';

export async function realisticPhoto(width = 1600, height = 1200): Promise<Buffer> {
  const w = width;
  const h = height;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs>` +
    `<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9824f"/><stop offset="0.5" stop-color="#9c6a3c"/><stop offset="1" stop-color="#7a4f2b"/></linearGradient>` +
    `<radialGradient id="light" cx="0.25" cy="0.15" r="0.9"><stop offset="0" stop-color="#fff2d8" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient>` +
    `<radialGradient id="plate" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d4cc"/></radialGradient>` +
    `<radialGradient id="bun" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#e9a45a"/><stop offset="0.7" stop-color="#b86a2a"/><stop offset="1" stop-color="#7d4217"/></radialGradient>` +
    `<filter id="soft"><feGaussianBlur stdDeviation="${w * 0.004}"/></filter>` +
    `<filter id="shadow"><feGaussianBlur stdDeviation="${w * 0.014}"/></filter>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#wood)"/>` +
    Array.from({ length: 26 }, (_, i) => `<rect x="0" y="${(i * h) / 26}" width="${w}" height="${h * 0.004}" fill="#4a2a10" fill-opacity="${0.12 + (i % 3) * 0.05}"/>`).join('') +
    `<ellipse cx="${w * 0.52}" cy="${h * 0.58}" rx="${w * 0.27}" ry="${h * 0.31}" fill="#000" fill-opacity="0.45" filter="url(#shadow)"/>` +
    `<ellipse cx="${w * 0.5}" cy="${h * 0.54}" rx="${w * 0.26}" ry="${h * 0.3}" fill="url(#plate)"/>` +
    `<ellipse cx="${w * 0.5}" cy="${h * 0.54}" rx="${w * 0.2}" ry="${h * 0.23}" fill="#ece7df" stroke="#cfc8bd" stroke-width="3"/>` +
    `<ellipse cx="${w * 0.5}" cy="${h * 0.52}" rx="${w * 0.13}" ry="${h * 0.15}" fill="url(#bun)" filter="url(#soft)"/>` +
    `<ellipse cx="${w * 0.46}" cy="${h * 0.46}" rx="${w * 0.04}" ry="${h * 0.04}" fill="#ffe2b0" fill-opacity="0.55" filter="url(#soft)"/>` +
    `<circle cx="${w * 0.18}" cy="${h * 0.78}" r="${h * 0.13}" fill="#2f5d50" filter="url(#soft)"/><circle cx="${w * 0.18}" cy="${h * 0.78}" r="${h * 0.1}" fill="#f4efe6"/>` +
    `<circle cx="${w * 0.83}" cy="${h * 0.25}" r="${h * 0.09}" fill="#8e2b2b" filter="url(#soft)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#light)"/>` +
    `</svg>`;
  const base = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  // Camera grain: deterministic pseudo-random noise so the same fixture is always the same file.
  const { data, info } = base;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 26;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += info.channels) {
    const n = rnd();
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] + n));
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 90 }).toBuffer();
}
