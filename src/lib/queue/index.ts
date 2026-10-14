// The queue (PRD v3 S-1 to S-6; changes C-24, C-27, C-28).
//
//   getQueueSettings / saveQueueSettings         cadence, days, a time per channel, auto-approve, email, pause
//   scheduleApproved / proposeSlots              approved posts into the next free slots (or what that would do)
//   listFreeSlots                                the next free times for a channel ("Pick another time")
//   moveQueueItem / skipQueueItem / unscheduleQueueItem   owner actions
//   postNowQueueItem / postNowApproved           send now through the same path as the sweep
//   autoApproveBrief                             auto-approve posts with no flags (per channel)
//   runQueueSweep                                the hourly cron: publish or deliver what is due
//   loadQueueView / loadScheduleStep             what the Queue page and the Schedule step show

export * from './types';
export { QueueError, queueMessage, queueFail, type QueueErrorCode, type QueueFailure, type QueueResult } from './errors';
export { getQueueSettings, saveQueueSettings } from './settings';
export { freeSlotsFor, findSlot, hasEnded, isoWeekdayOf, localDateOf, localTimeOf, mondayOf, timeFor, zonedToUtc, HORIZON_DAYS, MIN_LEAD_MS } from './slots';
export { formatSlot, formatSlotDay, slotParts } from './format';
export {
  ACTIONABLE,
  dropQueuedItems,
  listFreeSlots,
  listFreeSlotsForPost,
  markDueNow,
  moveQueueItem,
  proposeSlots,
  scheduleApproved,
  skipQueueItem,
  unscheduleQueueItem,
  type NoSlotReason,
  type Placement,
  type ScheduleArgs,
  type ScheduleOutcome,
} from './service';
export { postNowApproved, postNowQueueItem } from './post-now';
export { autoApproveBrief, type AutoApproveResult } from './auto-approve';
export { isBrandPaused, runItemsNow, runQueueSweep, type SweepDeps, type SweepSummary } from './sweep';
export { getPublisher, setPublisherForTests } from './publisher';
export { loadQueueView, type QueueCard, type QueueDay, type QueueView, type ReadyCard, type ScheduleLine, type ScheduleStep } from './view';
export { loadBrandTimezone, loadScheduleStep } from './schedule-step';
