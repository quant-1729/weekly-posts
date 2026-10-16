"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setMascotInPostsAction } from "@/app/(app)/brand/actions";
import { alertClass, cardClass, errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { pickScarf, scarfSwatches, tweenColorsFor, type BrandColorsInput } from "@/lib/mascot/colors";
import { fileUrl, type DownloadFile } from "@/lib/mascot/paths";
import type { MascotView } from "@/lib/mascot/service";
import { MAX_NAME_CHARS } from "@/lib/mascot/limits";
import { renderTween, type TweenPose } from "@/lib/mascot/tween";
import { saveMascotAction } from "./actions";

/**
 * The mascot screen (D9): Tween in the brand's colours (a few poses), the scarf colour (the brand's palette and
 * "Tween blue"), a name, the "Use the mascot in my posts" switch and the downloads. Why a mascot is or is not
 * offered comes first: regulated brands get none, formal ones confirm with "Try anyway".
 */

interface Props {
  brandId: string;
  eligibility: { eligible: boolean; reason: "regulated" | "formal" | "ok"; canOverride: boolean };
  mascot: MascotView | null;
  inPosts: boolean;
  brandColors: BrandColorsInput;
  downloads: DownloadFile[];
}

const PREVIEW_POSES: { pose: TweenPose; label: string }[] = [
  { pose: "wave", label: s.mascot.poseNames.wave },
  { pose: "point-right", label: s.mascot.poseNames.point },
  { pose: "celebrate", label: s.mascot.poseNames.celebrate },
];

function Drawing({ pose, label, colors }: { pose: TweenPose; label: string; colors: ReturnType<typeof tweenColorsFor> }) {
  // The SVG is drawn by our own code from a fixed rig and validated hex colours (no text, no images).
  return (
    <figure className="space-y-1 text-center">
      <div
        aria-hidden="true"
        className="mx-auto w-full max-w-[180px] lg:max-w-[220px] [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: renderTween({ pose, colors, size: 360 }) }}
      />
      <figcaption className="text-[13px] leading-[18px] text-desc">{label}</figcaption>
    </figure>
  );
}

async function downloadAll(files: DownloadFile[]) {
  for (const f of files) {
    const a = document.createElement("a");
    a.href = f.url;
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    // Browsers allow a burst of downloads when they are spaced a little.
    await new Promise((r) => setTimeout(r, 350));
  }
}

export function MascotScreen({ brandId, eligibility, mascot, inPosts: initialInPosts, brandColors, downloads }: Props) {
  const router = useRouter();
  const [name, setName] = useState(mascot?.name ?? "Tween");
  // The colour the owner picked this visit; null = nothing picked (keep what is saved).
  const [picked, setPicked] = useState<string | null>(null);
  const [tryAnyway, setTryAnyway] = useState(false);
  const [inPosts, setInPosts] = useState(initialInPosts);
  const [busy, setBusy] = useState<"save" | "switch" | "download" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const regulated = eligibility.reason === "regulated";
  const formal = !eligibility.eligible && !regulated;
  // The controls: for a brand that may have one, or one that has one already (it can edit it and download).
  const canEdit = !regulated && (eligibility.eligible || !!mascot || (formal && eligibility.canOverride && tryAnyway));

  const swatches = scarfSwatches(brandColors);
  const savedScarf = mascot?.scarf ?? null;
  const shown = picked ?? savedScarf ?? pickScarf(brandColors);
  const colors = tweenColorsFor(brandColors, picked ?? savedScarf);

  async function save() {
    setBusy("save");
    setMessage(null);
    const res = await saveMascotAction({ name, scarf: picked ?? undefined, tryAnyway });
    setBusy(null);
    if (!res.ok) {
      setMessage({ ok: false, text: res.message });
      return;
    }
    setName(res.mascot.name);
    setPicked(null);
    setMessage({ ok: true, text: s.mascot.saved });
    startTransition(() => router.refresh());
  }

  async function toggle(next: boolean) {
    setBusy("switch");
    setMessage(null);
    const res = await setMascotInPostsAction(brandId, next, tryAnyway);
    setBusy(null);
    if (!res.ok) {
      setMessage({ ok: false, text: res.message });
      return;
    }
    setInPosts(next);
    startTransition(() => router.refresh());
  }

  async function onDownloadAll() {
    setBusy("download");
    await downloadAll(downloads);
    setBusy(null);
  }

  return (
    // Phones: one column. Desktop: the preview and downloads on the left, the controls beside them.
    <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10 lg:gap-y-5 lg:space-y-0">
      {regulated && (
        <div className={`space-y-1 lg:col-span-2 ${alertClass("grey")}`}>
          <h2 className="text-ui text-title">{s.mascot.regulatedTitle}</h2>
          <p>{s.mascot.regulatedBody}</p>
        </div>
      )}

      {formal && (
        <div className={`space-y-3 lg:col-span-2 ${alertClass("grey")}`}>
          <div className="space-y-1">
            <h2 className="text-ui text-title">{s.mascot.formalTitle}</h2>
            <p>{s.mascot.formalBody}</p>
          </div>
          {!tryAnyway && !mascot && eligibility.canOverride && (
            <button type="button" className={secondaryButton} onClick={() => setTryAnyway(true)}>
              {s.mascot.tryAnyway}
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <div className="lg:col-start-1">
            <h2 className="mb-2 text-card-title text-title">{s.mascot.previewTitle}</h2>
            <div className={`grid grid-cols-3 gap-2 ${cardClass}`}>
              {PREVIEW_POSES.map((p) => (
                <Drawing key={p.pose} pose={p.pose} label={p.label} colors={colors} />
              ))}
            </div>
          </div>

          <div className="space-y-5 lg:col-start-2 lg:row-span-2">
          <div>
            <label htmlFor="mascot-name" className={labelClass}>
              {s.mascot.nameLabel}
            </label>
            <p className={hintClass}>{s.mascot.nameHelp}</p>
            <input
              id="mascot-name"
              className={inputClass}
              value={name}
              maxLength={MAX_NAME_CHARS}
              onChange={(e) => setName(e.target.value)}
              disabled={busy !== null}
            />
          </div>

          <fieldset>
            <legend className={labelClass}>{s.mascot.scarfLabel}</legend>
            <p className={hintClass}>{s.mascot.scarfHelp}</p>
            <div className="flex flex-wrap gap-3">
              {swatches.map((sw) => {
                const on = sw.hex.toLowerCase() === shown.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${s.mascot.swatch[sw.kind]} ${sw.hex.toUpperCase()}`}
                    onClick={() => setPicked(sw.hex)}
                    disabled={busy !== null}
                    className={`flex min-h-11 items-center gap-2 rounded-2xl border px-3 py-2 text-ui ${on ? "border-coral bg-coral-tint ring-1 ring-coral" : "border-line-input bg-white hover:border-line-input-hover"}`}
                  >
                    <span className="size-7 rounded-full border border-line-input" style={{ backgroundColor: sw.hex }} />
                    <span>{s.mascot.swatch[sw.kind]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <button type="button" className={primaryButton} onClick={save} disabled={busy !== null}>
            {busy === "save" ? s.mascot.saving : s.mascot.save}
          </button>

          <div className="space-y-1">
            <label className="flex items-start gap-3 text-[14px] leading-5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={inPosts}
                disabled={busy !== null}
                onChange={(e) => void toggle(e.target.checked)}
              />
              <span className="text-title">{s.mascot.useInPosts}</span>
            </label>
            <p className={hintClass}>{s.mascot.useInPostsHelp}</p>
          </div>
          </div>
        </>
      )}

      {mascot ? (
        <div className="space-y-3 lg:col-start-1">
          {mascot.sheet_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(mascot.sheet_path)} alt={s.mascot.sheetAlt} className="w-full rounded-xl bg-well" />
          )}
          <p className={hintClass}>{s.mascot.downloadHelp}</p>
          <button type="button" className={primaryButton} onClick={onDownloadAll} disabled={busy !== null}>
            {busy === "download" ? s.mascot.downloadingAll : s.mascot.downloadAll}
          </button>
        </div>
      ) : (
        canEdit && <p className={hintClass}>{s.mascot.downloadAfterSave}</p>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`${message.ok ? "text-[13px] font-medium leading-[18px] text-ok-tx" : errorClass} lg:col-span-2`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
