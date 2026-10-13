import type { FailCode, Stage, Timings } from "./generate";

/** One line of the newline-delimited JSON that POST /api/posts/generate streams to the create screen. */
export type StreamEvent =
  | { event: "stage"; stage: Stage }
  | { event: "done"; ok: true; postId: string; postCode: string; timings: Timings; openFlags: number }
  | { event: "done"; ok: false; code: FailCode; message: string; postId: string | null; timings?: Timings };
