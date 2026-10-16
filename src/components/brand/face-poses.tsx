"use client";

import type { ReactNode } from "react";
import { badge, hintClass, strongButton } from "@/components/ui";
import type { CardFace, CardPose } from "@/lib/faces/card-types";
import { FACE_POSES, type FacePose } from "@/lib/faces/types";
import { fill, s } from "@/lib/i18n/strings";
import { poseLabel } from "./face-ui";

const t = s.faces.card.poses;

/**
 * The seven poses of a face being made: the picture, whether the check found anything, and Approve. `redo` renders the
 * "make again" control of one pose (a priced button for a generated face, a photo picker for the owner's own face).
 * A pose that is not there yet shows `empty(pose)`.
 */
export function PoseGrid({
  face,
  busyPose,
  onApprove,
  redo,
  empty,
}: {
  face: CardFace;
  busyPose: FacePose | null;
  onApprove: (pose: FacePose) => void;
  redo: (pose: FacePose) => ReactNode;
  empty: (pose: FacePose) => ReactNode;
}) {
  const byPose = new Map<FacePose, CardPose>(face.poses.map((p) => [p.pose, p]));
  const approved = face.poses.filter((p) => p.approved).length;
  return (
    <div className="space-y-3">
      <p className={`${hintClass} !mb-0`}>{fill(t.progress, { approved, total: FACE_POSES.length })}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FACE_POSES.map((pose) => {
          const p = byPose.get(pose);
          return (
            <li key={pose} data-pose={pose} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-white p-2">
              <span className="text-ui text-title">{poseLabel(pose)}</span>
              {p ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={poseLabel(pose)} className="aspect-[3/4] w-full rounded-lg bg-cream object-contain" />
                  {p.approved ? (
                    <span className={badge("ok")}>{t.approved}</span>
                  ) : (
                    <>
                      {p.passed ? <span className={badge("neutral")}>{t.passed}</span> : p.notes ? <span className={badge("warn")}>{fill(t.notes, { notes: p.notes })}</span> : null}
                      <button type="button" className={strongButton} disabled={busyPose !== null} onClick={() => onApprove(pose)}>
                        {busyPose === pose ? t.approving : t.approve}
                      </button>
                    </>
                  )}
                  {redo(pose)}
                </>
              ) : (
                <>
                  <span className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-well text-note text-desc">{t.missing}</span>
                  {empty(pose)}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

