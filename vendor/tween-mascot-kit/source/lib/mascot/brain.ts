/**
 * The seam for a future brain (mascot.md 9). Design only: nothing here calls a model.
 *
 * `Brain.next` returns the same shape a dialogue node resolves to, so the character, bubbles, chips and actions stay
 * unchanged when the scripted runner is swapped. A later AI implementation must be constrained to this output shape and
 * to the site's own content, must label itself as an AI, and must pass the same honesty lint before anything is shown.
 */
import type { MascotAction } from "@/lib/content-schema";
import { resolveNode, type Choice, type Ctx, type Resolved } from "./dialogue";
import type { MascotContent } from "@/lib/content-schema";

export type BrainInput = {
  /** The node the visitor chose (a chip's `next`), or the start node. */
  nodeId: string;
  pathname: string;
  ctx: Ctx;
};

export type BrainOutput = { lines: string[]; pose?: string; actions: MascotAction[]; choices: Choice[] };

export interface Brain {
  next(input: BrainInput): Promise<BrainOutput>;
}

/** The only implementation that ships: it reads the written graph. */
export function scriptedBrain(content: MascotContent): Brain {
  return {
    async next({ nodeId, ctx }) {
      const r: Resolved | null = resolveNode(content, nodeId, ctx);
      if (!r) return { lines: [], actions: [], choices: [] };
      return { lines: r.lines, pose: r.pose, actions: r.actions, choices: r.choices };
    },
  };
}
