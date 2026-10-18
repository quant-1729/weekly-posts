"use client";

import { useEffect, useRef, useState } from "react";
import {
  approveFaceSheetAction,
  approvePoseAction,
  makeFaceOptionsAction,
  makeFacePosesAction,
  makeFaceSheetAction,
  pickFaceOptionAction,
  adoptFaceAction,
} from "@/app/(app)/brand/face-actions";
import { LiveDot } from "@/components/live/live-dot";
import { useLiveDoc } from "@/components/live/use-live";
import { alertClass, errorClass, hintClass, primaryButton, secondaryButton, smallButton } from "@/components/ui";
import type { CardFace } from "@/lib/faces/card-types";
import { BUSY_RETRY_PAUSE_MS, FACE_CAP_USD, stepEstimateUsd, wholeFaceEstimateUsd } from "@/lib/faces/generate/estimate";
import { FACE_OPTIONS, FACE_POSES, TRIES_PER_POSE, type FacePose } from "@/lib/faces/types";
import { fill, s } from "@/lib/i18n/strings";
import type { LiveRecordOf } from "@/lib/realtime/browser";
import { PoseGrid } from "./face-poses";
import { batches, money, POSE_BATCH } from "./face-ui";

const t = s.faces.card;

const micro = (usd: number) => Math.round(usd * 1_000_000);
/** Price of making these poses, as the sum of the small calls that make them (each call passes its own estimate). */
export const posesPrice = (count: number): number => batches(Array.from({ length: count }), POSE_BATCH).reduce((sum, b) => sum + stepEstimateUsd("poses", b.length), 0);
const imageCount = FACE_OPTIONS + 1 + FACE_POSES.length * TRIES_PER_POSE;

type Message = { ok: boolean; text: string } | null;

/** What the live status says is happening now, in the card's plain words ("Wave: try 1 of 2, drawing"). */
function liveText(f: LiveRecordOf<"face">): string {
  const p = t.progress;
  const parts: string[] = [];
  if (f.step === "options") parts.push(fill(p.optionOf, { n: Math.min(f.done + 1, f.total), total: f.total }));
  if (f.step === "poses" && f.pose) {
    const pose = s.faces.poses[f.pose as FacePose] ?? f.pose;
    if (f.phase === "saved") parts.push(fill(p.poseSaved, { pose }));
    else if (f.tryNo && f.tries && (f.phase === "drawing" || f.phase === "checking" || f.phase === "cutting")) parts.push(fill(p.poseStep, { pose, n: f.tryNo, total: f.tries, phase: p.phases[f.phase] }));
    else if (f.tryNo && f.tries) parts.push(fill(p.pose, { pose, n: f.tryNo, total: f.tries }));
  }
  if (f.phase === "waiting") parts.push(fill(p.waiting, { seconds: Math.round(BUSY_RETRY_PAUSE_MS / 1000) }));
  return parts.join(". ");
}

/**
 * Steps 3 and 4 of the Face card for a drawn character or a realistic AI person: the price first, then the options, the
 * character sheet and the seven poses, each priced on its own button and only started when it is pressed. The poses are
 * made two at a time so no call runs long; the card shows the progress.
 */
export function FaceMake({ face, brandId, onChange }: { face: CardFace; brandId: string; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [busyPose, setBusyPose] = useState<FacePose | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<FacePose[]>([]);

  // Live status (when it is on): the step, try and phase now running, and the pose that was just saved.
  const { live, doc } = useLiveDoc(brandId, `face_${face.id}`);
  const liveFace = doc && doc.kind === "face" ? doc : null;
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!liveFace) return;
    const first = lastSeq.current === null; // the first document seen only sets the baseline (it may be an old run)
    const changed = lastSeq.current !== liveFace.seq;
    lastSeq.current = liveFace.seq;
    if (!first && changed && liveFace.step === "poses" && liveFace.phase === "saved") void onChange();
  }, [liveFace, onChange]);
  const liveLine = (step: "options" | "sheet" | "poses") => {
    if (busy === null || !liveFace || liveFace.state !== "running" || liveFace.step !== step) return null;
    const text = liveText(liveFace);
    return text ? (
      <p role="status" data-live-progress className={hintClass}>
        {text}
      </p>
    ) : null;
  };
  const dot = live ? (
    <div>
      <LiveDot live={live} />
    </div>
  ) : null;

  const afford = (price: number) => micro(face.spentUsd) + micro(price) <= micro(FACE_CAP_USD);
  const fail = (text: string) => setMessage({ ok: false, text });

  async function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(label);
    setMessage(null);
    const r = await fn();
    if (!r.ok) fail(r.message);
    await onChange();
    setBusy(null);
  }

  const options = face.optionUrls.some(Boolean);
  const optionsPrice = stepEstimateUsd("options");
  const sheetPrice = stepEstimateUsd("sheet");

  async function makeOptions() {
    await run("options", async () => {
      const r = await makeFaceOptionsAction(face.id, optionsPrice);
      if (r.ok && r.failed > 0) setMessage({ ok: true, text: fill(t.options.someFailed, { count: r.failed }) });
      return r;
    });
  }

  async function makePoses(poses: FacePose[]) {
    setBusy("poses");
    setMessage(null);
    setFailed([]);
    const missed: FacePose[] = [];
    let done = 0;
    setProgress({ done, total: poses.length });
    for (const group of batches(poses, POSE_BATCH)) {
      const r = await makeFacePosesAction(face.id, group, stepEstimateUsd("poses", group.length));
      if (!r.ok) {
        fail(r.message);
        break;
      }
      missed.push(...r.failed.map((f) => f.pose));
      done += group.length;
      setProgress({ done, total: poses.length });
      await onChange();
    }
    setFailed(missed);
    setProgress(null);
    await onChange();
    setBusy(null);
  }

  async function approvePose(pose: FacePose) {
    setBusyPose(pose);
    setMessage(null);
    const r = await approvePoseAction(face.id, pose);
    if (!r.ok) fail(r.message);
    await onChange();
    setBusyPose(null);
  }

  const statusLine = message && (
    <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[13px] leading-[18px] text-ok-tx" : errorClass}>
      {message.text}
    </p>
  );
  const spent = <p className={`${hintClass} !mb-0`}>{fill(t.spent, { spent: money(face.spentUsd), cap: money(FACE_CAP_USD) })}</p>;
  const overCap = <p className={errorClass}>{s.faces.generate.errors.over_cap}</p>;

  // --- a. options ---------------------------------------------------------------------------
  if (!face.masterUrl) {
    return (
      <div className="space-y-4">
        {!options && (
          <div className={alertClass("info")} data-price-block>
            <p className="font-medium text-title">{fill(t.price.total, { total: money(wholeFaceEstimateUsd()), images: imageCount })}</p>
            <p className="mt-1">{fill(t.price.steps, { options: money(optionsPrice), sheet: money(sheetPrice), poses: money(posesPrice(FACE_POSES.length)) })}</p>
          </div>
        )}
        {options && (
          <div className="space-y-2">
            <h3 className="text-card-title text-title">{t.options.title}</h3>
            <p className={hintClass}>{t.options.hint}</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {face.optionUrls.map((url, i) =>
                url ? (
                  <li key={i} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-white p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={fill(t.options.optionAlt, { n: i + 1 })} className="aspect-[3/4] w-full rounded-lg bg-cream object-contain" />
                    <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void run(`pick${i}`, () => pickFaceOptionAction(face.id, i))}>
                      {busy === `pick${i}` ? t.options.keeping : t.options.keep}
                    </button>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
        {spent}
        <div className="space-y-2">
          <button type="button" className={options ? secondaryButton : primaryButton} disabled={busy !== null || !afford(optionsPrice)} onClick={() => void makeOptions()}>
            {fill(options ? t.price.makeOptionsAgain : t.price.makeOptions, { price: money(optionsPrice) })}
          </button>
          {!afford(optionsPrice) && overCap}
          {busy === "options" && (
            <p role="status" className={hintClass}>
              {fill(t.price.makingOptions, { count: FACE_OPTIONS })}
            </p>
          )}
          {liveLine("options")}
          {busy === "options" && dot}
          {statusLine}
        </div>
      </div>
    );
  }

  // --- b. character sheet -------------------------------------------------------------------
  if (!face.sheetUrl) {
    return (
      <div className="space-y-4">
        <h3 className="text-card-title text-title">{t.sheet.title}</h3>
        <p className={hintClass}>{t.sheet.hint}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={face.masterUrl} alt={t.sheet.masterAlt} className="max-h-80 w-full rounded-2xl border border-line bg-cream object-contain" />
          {face.sheetDraftUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={face.sheetDraftUrl} alt={t.sheet.sheetAlt} className="max-h-80 w-full rounded-2xl border border-line bg-cream object-contain" />
          )}
        </div>
        {spent}
        <div className="flex flex-wrap gap-2">
          {face.sheetDraftUrl && (
            <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void run("approveSheet", () => approveFaceSheetAction(face.id))}>
              {busy === "approveSheet" ? t.sheet.approving : t.sheet.approve}
            </button>
          )}
          <button
            type="button"
            className={face.sheetDraftUrl ? secondaryButton : primaryButton}
            disabled={busy !== null || !afford(sheetPrice)}
            onClick={() => void run("sheet", () => makeFaceSheetAction(face.id, sheetPrice))}
          >
            {fill(face.sheetDraftUrl ? t.sheet.makeAgain : t.sheet.make, { price: money(sheetPrice) })}
          </button>
        </div>
        {!afford(sheetPrice) && overCap}
        {busy === "sheet" && (
          <p role="status" className={hintClass}>
            {t.sheet.making}
          </p>
        )}
        {liveLine("sheet")}
        {busy === "sheet" && dot}
        {statusLine}
      </div>
    );
  }

  // --- c. poses -----------------------------------------------------------------------------
  const have = new Set(face.poses.map((p) => p.pose));
  const todo = FACE_POSES.filter((p) => !have.has(p));
  const price = posesPrice(todo.length);
  const redoPrice = stepEstimateUsd("poses", 1);
  const allApproved = FACE_POSES.every((p) => face.poses.some((x) => x.pose === p && x.approved));
  return (
    <div className="space-y-4">
      <h3 className="text-card-title text-title">{t.poses.title}</h3>
      <p className={hintClass}>{t.poses.hint}</p>
      {todo.length > 0 && (
        <div className="space-y-2">
          <button type="button" className={primaryButton} disabled={busy !== null || !afford(price)} onClick={() => void makePoses(todo)}>
            {fill(todo.length === FACE_POSES.length ? t.poses.make : t.poses.makeMissing, { price: money(price) })}
          </button>
          {!afford(price) && overCap}
        </div>
      )}
      {progress && (
        <p role="status" className={hintClass}>
          {fill(t.poses.making, progress)}
        </p>
      )}
      {liveLine("poses")}
      {progress && dot}
      {failed.length > 0 && (
        <p role="alert" className={errorClass}>
          {fill(t.poses.failed, { poses: failed.map((p) => s.faces.poses[p]).join(", ") })}
        </p>
      )}
      {face.poses.length > 0 && (
        <PoseGrid
          face={face}
          busyPose={busyPose}
          onApprove={(pose) => void approvePose(pose)}
          redo={(pose) => (
            <button type="button" className={smallButton} disabled={busy !== null || !afford(redoPrice)} onClick={() => void makePoses([pose])}>
              {fill(t.poses.redo, { price: money(redoPrice) })}
            </button>
          )}
          empty={() => null}
        />
      )}
      {spent}
      {statusLine}
      {allApproved && (
        <div className="space-y-1">
          <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void run("use", () => adoptFaceAction(face.id))}>
            {busy === "use" ? t.use.using : t.use.button}
          </button>
          <p className={hintClass}>{t.use.hint}</p>
        </div>
      )}
    </div>
  );
}
