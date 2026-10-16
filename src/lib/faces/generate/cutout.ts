// `cutout(png, mode)`: a transparent PNG from a picture.
//  - 'chroma'  : an AI image made on flat #00FF00 (drawn characters and realistic AI people). Pure JS, free.
//  - 'matting' : a real photo (owner_photo, F-6). Needs the cut-out service at CUTOUT_URL (services/cutout/).

import { chromaKey } from './chroma';
import { mattingCutout } from './matting';

export type CutoutMode = 'chroma' | 'matting';
export type CutoutFn = (png: Buffer, mode: CutoutMode) => Promise<Buffer>;

export const cutout: CutoutFn = (png, mode) => (mode === 'chroma' ? chromaKey(png) : mattingCutout(png));

export { chromaKey } from './chroma';
export { mattingCutout, mattingConfigured } from './matting';
