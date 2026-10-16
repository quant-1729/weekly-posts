"use client";

import { useId, useRef, useState } from "react";
import { approvePoseAction, requestFaceConsentAction, adoptFaceAction } from "@/app/(app)/brand/face-actions";
import { alertClass, errorClass, hintClass, primaryButton, secondaryButton, smallButton } from "@/components/ui";
import type { CardFace } from "@/lib/faces/card-types";
import { FACE_POSES, type FacePose } from "@/lib/faces/types";
import { fill, s } from "@/lib/i18n/strings";
import { PoseGrid } from "./face-poses";
import { poseLabel, uploadOwnerPhoto } from "./face-ui";

const t = s.faces.card.owner;

/** A file picker that looks like a small button. */
function Picker({ poses, text, primary = false, disabled, working, onPick }: { poses: FacePose[]; text: string; primary?: boolean; disabled: boolean; working: boolean; onPick: (file: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={fill(t.photoFor, { pose: poses.length === 1 ? poseLabel(poses[0]) : text })}
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          onPick(file);
        }}
      />
      <button type="button" className={primary ? secondaryButton : smallButton} disabled={disabled} onClick={() => ref.current?.click()}>
        {working ? "…" : text}
      </button>
    </>
  );
}

/**
 * "Me (my own photos)" (F-6). First the consent: a ticked box and an email link, like a payment ID. Only then can photos
 * be added; each is cut out by the background-removal service, shown, and approved pose by pose. No AI makes the face.
 * When the service is not set up the card says so and stays usable.
 */
export function FaceOwner({ face, cutoutConfigured, onChange }: { face: CardFace; cutoutConfigured: boolean; onChange: () => Promise<void> }) {
  const id = useId();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyPose, setBusyPose] = useState<FacePose | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const consent = face.consent ?? { asked: false, confirmed: false, expired: false };
  const pending = consent.asked && !consent.confirmed && !consent.expired;

  async function send() {
    setBusy("consent");
    setMessage(null);
    const r = await requestFaceConsentAction(face.id, agreed);
    setMessage(r.ok ? { ok: true, text: t.sent } : { ok: false, text: r.message });
    await onChange();
    setBusy(null);
  }

  async function upload(poses: FacePose[], file: File | undefined, label: string) {
    if (!file) return;
    setBusy(label);
    setMessage(null);
    const r = await uploadOwnerPhoto(face.id, poses, file);
    setMessage(r.ok ? { ok: true, text: t.added } : { ok: false, text: r.message });
    await onChange();
    setBusy(null);
  }

  async function approve(pose: FacePose) {
    setBusyPose(pose);
    setMessage(null);
    const r = await approvePoseAction(face.id, pose);
    if (!r.ok) setMessage({ ok: false, text: r.message });
    await onChange();
    setBusyPose(null);
  }

  async function use() {
    setBusy("use");
    setMessage(null);
    const r = await adoptFaceAction(face.id);
    if (!r.ok) setMessage({ ok: false, text: r.message });
    await onChange();
    setBusy(null);
  }

  const have = new Set(face.poses.map((p) => p.pose));
  const empty = FACE_POSES.filter((p) => !have.has(p));
  const allApproved = FACE_POSES.every((p) => face.poses.some((x) => x.pose === p && x.approved));
  const pickDisabled = busy !== null || !cutoutConfigured;
  const status = message && (
    <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-[13px] leading-[18px] text-ok-tx" : errorClass}>
      {message.text}
    </p>
  );

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby={`${id}-consent`}>
        <h3 id={`${id}-consent`} className="text-card-title text-title">
          {t.consentTitle}
        </h3>
        {consent.confirmed ? (
          <p role="status" className={alertClass("ok")}>
            {t.confirmed}
          </p>
        ) : (
          <>
            <p className={hintClass}>{t.consentDetail}</p>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-6" checked={agreed} disabled={busy !== null} onChange={(e) => setAgreed(e.target.checked)} />
              <span className="font-medium">{t.consentBox}</span>
            </label>
            {pending && <p className={alertClass("warn")}>{t.waiting}</p>}
            <button type="button" className={pending ? secondaryButton : primaryButton} disabled={busy !== null || !agreed} onClick={() => void send()}>
              {busy === "consent" ? t.sending : pending || consent.expired ? t.resend : t.send}
            </button>
          </>
        )}
      </section>

      {consent.confirmed && (
        <section className="space-y-3" aria-labelledby={`${id}-photos`}>
          <h3 id={`${id}-photos`} className="text-card-title text-title">
            {t.photosTitle}
          </h3>
          <p className={hintClass}>{t.photosHint}</p>
          {!cutoutConfigured && (
            <p role="status" className={alertClass("warn")} data-cutout-missing>
              {t.noCutout}
            </p>
          )}
          {empty.length > 1 && <Picker poses={empty} text={t.allPoses} primary disabled={pickDisabled} working={busy === "all"} onPick={(f) => void upload(empty, f, "all")} />}
          {busy !== null && busy !== "use" && busy !== "consent" && (
            <p role="status" className={hintClass}>
              {t.uploading}
            </p>
          )}
          <PoseGrid
            face={face}
            busyPose={busyPose}
            onApprove={(pose) => void approve(pose)}
            redo={(pose) => <Picker poses={[pose]} text={t.replace} disabled={pickDisabled} working={busy === `redo-${pose}`} onPick={(f) => void upload([pose], f, `redo-${pose}`)} />}
            empty={(pose) => <Picker poses={[pose]} text={t.chooseFor} disabled={pickDisabled} working={busy === `add-${pose}`} onPick={(f) => void upload([pose], f, `add-${pose}`)} />}
          />
          <p className={hintClass}>{t.privacy}</p>
          {status}
          {allApproved && (
            <div className="space-y-1">
              <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void use()}>
                {busy === "use" ? s.faces.card.use.using : s.faces.card.use.button}
              </button>
              <p className={hintClass}>{s.faces.card.use.hint}</p>
            </div>
          )}
        </section>
      )}
      {!consent.confirmed && status}
    </div>
  );
}
