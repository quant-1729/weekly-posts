// Why a Brand Face change was refused. Codes are stable (tests and the UI match on them); `s.faces.errors` holds the words.

export type FaceErrorCode =
  | 'bad_kind' // not one of the four kinds
  | 'kind_not_allowed' // a realistic AI person for a health, finance, legal or alcohol brand; a mascot for a regulated brand
  | 'bad_name'
  | 'bad_character' // not one of the characters on offer (Laltain is not offered), or given to a face that is not a mascot
  | 'blocked_name' // the name is a religious, political, celebrity or known-mascot name
  | 'real_person' // the description asks the face to look like a real or famous person
  | 'unsuitable_description' // sexual or attractiveness wording, or a young age: not a brand face
  | 'copied_character' // the description copies a known cartoon, film or game character or franchise
  | 'bad_description'
  | 'bad_style'
  | 'bad_settings' // placement, never-say phrases or post types
  | 'needs_poses' // approval needs all 7 poses, each approved by the owner
  | 'needs_consent' // the owner's own face needs the confirmed consent
  | 'consent_missing' // the consent box was not ticked
  | 'consent_email' // the confirmation email could not be sent
  | 'consent_no_email' // the account has no email address
  | 'consent_rate_limited' // too many confirmation emails this hour
  | 'bad_status' // e.g. approving a face that is not a draft, or using one that is not approved
  | 'bad_pose' // not a pose, or not a usable transparent image
  | 'not_found';

export class FaceError extends Error {
  constructor(
    public readonly code: FaceErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FaceError';
  }
}
