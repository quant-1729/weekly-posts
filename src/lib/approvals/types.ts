// Shared types of the approval operations (V-16). Used by the email-link pages (no login) and
// the dashboard (signed in), so both do exactly the same thing.

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';
import type { Flag } from '@/lib/guardrail';
import type { Storage } from '@/lib/storage';

/** Who is acting. Email-link actors were checked by the link dispatcher; dashboard actors are checked here. */
export type Actor = { via: 'email_link'; jtiHash: string } | { via: 'dashboard'; userId: string };

export interface PostRef {
  brandId: string;
  postId: string;
  actor: Actor;
}

/** Test and dev hooks. Production code passes none. */
export interface OpDeps {
  now?: Date;
  storage?: Storage;
}

export type FailCode =
  | 'not_found'
  | 'forbidden'
  | 'blocked'
  | 'not_open'
  | 'ack_required'
  | 'must_edit'
  | 'cannot_remove'
  | 'posted'
  | 'not_approved'
  | 'too_late'
  | 'invalid'
  | 'photo_not_found'
  | 'photo_unusable'
  | 'photo_missing'
  | 'cap'
  | 'ai_failed';

export interface OpFail {
  ok: false;
  code: FailCode;
  /** A plain sentence for the owner. */
  message: string;
  /** For `blocked`: the flags that are still open. */
  flags?: Flag[];
  /** For `invalid`: one sentence per problem. */
  errors?: string[];
}

export interface PostRecord {
  id: string;
  brandId: string;
  batchId: string;
  weekStart: string;
  status: string;
  channel: V2Channel;
  postLanguage: string;
  suggestedDay: string | null;
  postCode: string;
  caption: string;
  cta: string;
  hashtags: string[];
  /** headline and subline are on the image; bubble and pose are the mascot's (V-25), '' when there is none. */
  imageText: { headline: string; subline: string; bubble: string; pose: string };
  photoId: string | null;
  /** The mascot drawn on the square and vertical images, or null (off). */
  mascotId: string | null;
  flags: Flag[];
  editedAt: string | null;
  approvedAt: string | null;
  skippedAt: string | null;
  postedAt: string | null;
}

export type OpOk<T = object> = { ok: true; post: PostRecord } & T;
export type OpResult<T = object> = OpOk<T> | OpFail;
