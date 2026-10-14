"use client";

import Link from "next/link";
import type { BlockLine } from "@/lib/briefs/editor-state";
import type { Blocks, BlockKey } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";
import { EditorCard, pickClass } from "./card";

const t = s.create.blocks;

/**
 * Contact and info blocks (B-4): a switch for each, showing the exact text that will appear on the
 * post. A block the brand doesn't have yet can't be switched on; "Add it" goes to the Brand page.
 */
export function BlocksPicker({
  lines,
  blocks,
  fromDescription,
  onToggle,
}: {
  lines: BlockLine[];
  blocks: Blocks;
  fromDescription: boolean;
  onToggle: (key: BlockKey, on: boolean) => void;
}) {
  return (
    <EditorCard id="blocks" title={t.title} hint={t.hint} fromDescription={fromDescription}>
      <ul className="space-y-2 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
        {lines.map((line) => {
          const available = line.text !== null;
          const on = blocks[line.key] === true && available;
          return (
            <li key={line.key} data-block={line.key} className="min-w-0">
              <label className={pickClass(on, !available && line.key !== "dates")}>
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  checked={on}
                  disabled={!available}
                  onChange={(e) => onToggle(line.key, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{line.label}</span>
                  {available ? (
                    <span data-block-text className="block break-words text-stone-700">
                      {line.text}
                    </span>
                  ) : (
                    <span className="block text-sm text-stone-500">{line.key === "dates" ? t.datesNone : t.notAdded}</span>
                  )}
                </span>
              </label>
              {!available && line.addHref && (
                <Link href={line.addHref} className="ml-1 inline-flex min-h-11 items-center text-sm font-medium underline">
                  {t.addIt}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </EditorCard>
  );
}
