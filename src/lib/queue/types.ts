// Queue and publishing contract (PRD v3 §5.5, changes C-24 to C-28). Orchestrator-owned: builders
// import these. Mirrors supabase/migrations/0019_v3_queue.sql.

import { z } from 'zod';

/** Channels a brief can target (post_channel enum). */
export const QUEUE_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'youtube', 'linkedin', 'gbp'] as const;
export type QueueChannel = (typeof QUEUE_CHANNELS)[number];

/**
 * Channels we can auto-publish to, once connected (S-3). Everything else is delivered to the owner
 * at its slot (email with one-tap Share, Download and Copy).
 */
export const PUBLISH_PROVIDER: Partial<Record<QueueChannel, Provider>> = {
  instagram: 'instagram',
  facebook: 'facebook',
};

export const PROVIDERS = ['instagram', 'facebook'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const QUEUE_STATUSES = ['scheduled', 'publishing', 'published', 'delivered', 'missed', 'skipped', 'expired', 'failed'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export type QueueMode = 'publish' | 'deliver';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Queue settings (S-1, S-4, S-6). */
export const queueSettingsSchema = z.object({
  postsPerWeek: z.number().int().min(1).max(14),
  /** ISO weekdays, 1 = Monday. */
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  /** Preferred time per channel in the brand's time zone; missing → DEFAULT_TIME. */
  times: z.partialRecord(z.enum(QUEUE_CHANNELS), hhmm),
  /** Auto-approve posts with no open flags, per channel (S-4). Off by default. */
  autoApprove: z.partialRecord(z.enum(QUEUE_CHANNELS), z.boolean()),
  deliverEmail: z.boolean(),
  paused: z.boolean(),
});
export type QueueSettings = z.infer<typeof queueSettingsSchema>;

export const DEFAULT_TIME = '10:00';
export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  postsPerWeek: 3,
  days: [2, 4, 6],
  times: {},
  autoApprove: {},
  deliverEmail: true,
  paused: false,
};

export interface QueueItem {
  id: string;
  brandId: string;
  postId: string;
  channel: QueueChannel;
  slotAt: string; // ISO timestamp (UTC)
  status: QueueStatus;
  mode: QueueMode;
  attempts: number;
  lastError: string | null;
  platformPostId: string | null;
  permalink: string | null;
  doneAt: string | null;
}

/** Retries before a publish is given up and the owner is told to share it themselves (S-3.1). */
export const MAX_PUBLISH_ATTEMPTS = 3;
/** A scheduled slot this long in the past without being handled counts as missed (S-2). */
export const MISSED_AFTER_MINUTES = 90;

/** What the publisher returns for one queue item. */
export type PublishResult =
  | { ok: true; platformPostId: string; permalink: string | null }
  | { ok: false; retryable: boolean; reason: 'not_connected' | 'token_expired' | 'rate_limited' | 'media_rejected' | 'network' | 'unknown'; message: string };

/**
 * The seam between the queue (builder Q1) and auto-publishing (builder Q2). The queue sweep calls
 * `publishQueueItem` for due items in mode 'publish'; the publisher loads the post, its images
 * (public signed URLs) and the connection, publishes, and returns a result. The queue owns status
 * changes and retries; the publisher never changes queue rows itself.
 */
export type PublishQueueItem = (args: { itemId: string; brandId: string }) => Promise<PublishResult>;
