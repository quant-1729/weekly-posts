// Why a face-generation step stopped. Codes are stable; `s.faces.generate.errors` holds the words.
// (Rule errors such as a regulated brand asking for a realistic person are FaceError codes from ../errors.)

export type FaceGenErrorCode =
  | 'not_approved' // the owner has not approved the price (approvedEstimateUsd missing or lower than the estimate)
  | 'over_cap' // this face's spend plus the estimate would pass the per-face cap
  | 'over_budget' // a step reached the approved amount part-way; what was made is kept
  | 'not_ai_face' // only a drawn character or a realistic AI person is made by AI
  | 'needs_master' // the sheet needs a picked master
  | 'needs_sheet' // poses need an approved sheet
  | 'no_option' // the option number was not made
  | 'image_failed' // the image model returned nothing usable
  | 'cutout_not_configured' // CUTOUT_URL is not set (real photos)
  | 'cutout_failed'; // the cut-out step could not make a clean transparent image

export class FaceGenError extends Error {
  constructor(
    public readonly code: FaceGenErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FaceGenError';
  }
}
