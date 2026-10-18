// A tiny element tree for SVG: the scene builder makes one, the browser turns it into React elements and the
// server turns it into a string for resvg. Attribute names are React-style (camelCase); `toSvgString` writes
// them the way SVG spells them.

export interface VNode {
  t: string;
  a?: Record<string, string | number | undefined>;
  /** CSS properties (React-style names). */
  s?: Record<string, string | number>;
  c?: (VNode | string)[];
  /** Raw SVG markup inside the element (our own code-drawn character only). */
  raw?: string;
  k?: string;
}

export const h = (t: string, a?: VNode['a'], c?: VNode['c'], extra?: Partial<VNode>): VNode => ({ t, a, c, ...extra });

/** SVG attributes that keep their camelCase spelling. */
const KEEP = new Set([
  'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'patternContentUnits',
  'stdDeviation', 'maskUnits', 'maskContentUnits', 'clipPathUnits', 'filterUnits', 'primitiveUnits', 'baseFrequency', 'numOctaves',
  'tableValues', 'kernelMatrix', 'edgeMode', 'xChannelSelector', 'yChannelSelector', 'spreadMethod', 'startOffset', 'textLength',
  'lengthAdjust', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'pathLength', 'xlinkHref',
]);

const kebab = (n: string) => (KEEP.has(n) ? (n === 'xlinkHref' ? 'xlink:href' : n) : n.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toSvgString(n: VNode | string): string {
  if (typeof n === 'string') return escText(n);
  let out = `<${n.t}`;
  if (n.t === 'svg') out += ' xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
  for (const [k, v] of Object.entries(n.a ?? {})) if (v !== undefined && v !== null) out += ` ${kebab(k)}="${esc(String(v))}"`;
  if (n.s && Object.keys(n.s).length) out += ` style="${esc(Object.entries(n.s).map(([k, v]) => `${kebab(k)}:${v}`).join(';'))}"`;
  const inner = (n.raw ?? '') + (n.c ?? []).map(toSvgString).join('');
  return inner ? `${out}>${inner}</${n.t}>` : `${out}/>`;
}
