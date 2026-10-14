// When a connection is created, reconnected or renewed, the brand's queued "we'll email it to you" items for that
// provider's channels become auto-publish (PRD v3 S-3: auto-publishing is preferred once it is possible).
// Called by src/lib/connections/service.ts. Only `scheduled` items change; anything already sent or in flight is left alone.

import { getDb } from '@/lib/db';
import { PUBLISH_PROVIDER, type Provider } from './types';

/** Returns how many queued items were upgraded. */
export async function upgradeQueuedToPublish(brandId: string, provider: Provider): Promise<number> {
  const channels = Object.entries(PUBLISH_PROVIDER)
    .filter(([, p]) => p === provider)
    .map(([c]) => c);
  if (channels.length === 0) return 0;
  const rows = await getDb().withService((tx) =>
    tx.query<{ id: string }>(
      `update public.queue_items set mode = 'publish', updated_at = now()
        where brand_id = $1 and status = 'scheduled' and mode = 'deliver' and channel::text = any($2::text[]) returning id::text as id`,
      [brandId, channels],
    ),
  );
  return rows.length;
}
