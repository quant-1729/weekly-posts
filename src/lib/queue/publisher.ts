// The one place the queue learns which publisher to call (the seam to auto-publishing, builder Q2).
//
// The real publisher (`@/lib/publish`, builder Q2), loaded lazily so the queue and the publisher
// never import each other at module load. Tests and callers can pass their own publisher to
// `runQueueSweep({ deps: { publish } })` or use `setPublisherForTests`.

import type { PublishQueueItem, Provider } from './types';

const defaultPublisher: PublishQueueItem = async (args) => (await import('@/lib/publish')).publishQueueItem(args);

let override: PublishQueueItem | null = null;

/** Tests only: use this publisher instead of the default. Pass null to go back. */
export function setPublisherForTests(publisher: PublishQueueItem | null): void {
  override = publisher;
}

export function getPublisher(): PublishQueueItem {
  return override ?? defaultPublisher;
}

/**
 * Tells the connections module that a channel's connection no longer works. It marks the connection expired or
 * errored and emails the owners ONCE per problem (only the call that flips an active connection sends), so the
 * queue can call it for every failed item without sending the owner a pile of emails.
 */
export type ReportConnectionProblem = (args: { brandId: string; provider: Provider; status: 'expired' | 'error'; message: string }) => Promise<boolean>;

export const defaultReportConnectionProblem: ReportConnectionProblem = async (args) => {
  const { markConnectionProblem } = await import('@/lib/connections/service');
  return markConnectionProblem(args);
};
