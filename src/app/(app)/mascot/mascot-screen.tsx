"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton, errorClass } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { drawMascotDocument } from "@/lib/mascot/rig";
import { fileUrl, type DownloadFile } from "@/lib/mascot/paths";
import type { MascotView } from "@/lib/mascot/service";
import { generateConceptsAction, pickMascotAction } from "./actions";

/**
 * The mascot screen (R15): why a mascot is or is not offered, an optional hint,
 * 3 concepts to pick from, and the chosen mascot's character sheet with
 * downloads. "Make a new mascot" goes back to concepts; the current mascot stays
 * active until a new one is picked.
 */

interface Props {
  eligibility: { eligible: boolean; reason: "regulated" | "formal" | "ok"; canOverride: boolean };
  active: MascotView | null;
  downloads: DownloadFile[];
  concepts: MascotView[];
}

function Drawing({ spec }: { spec: MascotView["spec"] }) {
  // The SVG is drawn by our own code from a validated spec (hex colours and fixed part names only).
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[260px] [&_svg]:h-auto [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: drawMascotDocument(spec, "wave") }}
    />
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

export function MascotScreen({ eligibility, active, downloads, concepts: initialConcepts }: Props) {
  const router = useRouter();
  const [concepts, setConcepts] = useState<MascotView[]>(initialConcepts);
  const [fewer, setFewer] = useState(false);
  const [hint, setHint] = useState("");
  const [tryAnyway, setTryAnyway] = useState(false);
  const [makingNew, setMakingNew] = useState(!!active && initialConcepts.length > 0);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const regulated = !eligibility.eligible && eligibility.reason === "regulated";
  const formal = !eligibility.eligible && eligibility.reason !== "regulated";
  const canMake = eligibility.eligible || (formal && eligibility.canOverride && tryAnyway);
  // Show the concepts flow when there is no mascot yet, or the owner asked for a new one.
  const showFlow = !active || makingNew;

  async function makeConcepts() {
    setBusy(true);
    setProblem(null);
    const res = await generateConceptsAction(hint, tryAnyway);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.message);
      return;
    }
    setConcepts(res.concepts);
    setFewer(res.fewer);
  }

  async function pick(id: string) {
    setPicking(id);
    setProblem(null);
    const res = await pickMascotAction(id);
    if (!res.ok) {
      setPicking(null);
      setProblem(res.message);
      return;
    }
    setMakingNew(false);
    setConcepts([]);
    setPicking(null);
    startTransition(() => router.refresh());
  }

  async function onDownloadAll() {
    setDownloading(true);
    await downloadAll(downloads);
    setDownloading(false);
  }

  return (
    <div className="space-y-5">
      {regulated && (
        <div className="space-y-1 rounded-lg border border-stone-300 bg-stone-50 p-4">
          <h2 className="font-semibold">{s.mascot.regulatedTitle}</h2>
          <p className="text-stone-700">{s.mascot.regulatedBody}</p>
        </div>
      )}

      {formal && (
        <div className="space-y-3 rounded-lg border border-stone-300 bg-stone-50 p-4">
          <div className="space-y-1">
            <h2 className="font-semibold">{s.mascot.formalTitle}</h2>
            <p className="text-stone-700">{s.mascot.formalBody}</p>
          </div>
          {!tryAnyway && showFlow && eligibility.canOverride && (
            <button type="button" className={secondaryButton} onClick={() => setTryAnyway(true)}>
              {s.mascot.tryAnyway}
            </button>
          )}
        </div>
      )}

      {active && !makingNew && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {s.mascot.activeTitle}: {active.name}
            {active.name_local ? <span> · {active.name_local}</span> : null}
          </h2>
          {active.personality && <p className="text-stone-600">{active.personality}</p>}
          {active.sheet_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(active.sheet_path)} alt={s.mascot.sheetAlt} className="w-full rounded-xl bg-stone-50" />
          )}
          <p className={hintClass}>{s.mascot.downloadHelp}</p>
          <button type="button" className={primaryButton} onClick={onDownloadAll} disabled={downloading}>
            {downloading ? s.mascot.downloadingAll : s.mascot.downloadAll}
          </button>
          {!regulated && (
            <div className="space-y-1">
              <button type="button" className={secondaryButton} onClick={() => setMakingNew(true)}>
                {s.mascot.makeNew}
              </button>
              <p className={hintClass}>{s.mascot.makeNewHelp}</p>
            </div>
          )}
        </div>
      )}

      {showFlow && canMake && (
        <div className="space-y-4">
          {concepts.length === 0 && (
            <div>
              <label htmlFor="mascot-hint" className={labelClass}>
                {s.mascot.hintLabel}
              </label>
              <p className={hintClass}>{s.mascot.hintHelp}</p>
              <input
                id="mascot-hint"
                className={inputClass}
                value={hint}
                maxLength={300}
                placeholder={s.mascot.hintPlaceholder}
                onChange={(e) => setHint(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          {concepts.length === 0 ? (
            <button type="button" className={primaryButton} onClick={makeConcepts} disabled={busy}>
              {busy ? s.mascot.makingConcepts : s.mascot.makeConcepts}
            </button>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{s.mascot.conceptsTitle}</h2>
              {fewer && <p className={hintClass}>{fill(s.mascot.conceptsFew, { n: concepts.length })}</p>}
              <ul className="space-y-4">
                {concepts.map((c) => (
                  <li key={c.id} className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
                    <Drawing spec={c.spec} />
                    <div className="text-center">
                      <p className="text-lg font-bold">
                        {c.name}
                        {c.name_local ? <span> · {c.name_local}</span> : null}
                      </p>
                      <p className="text-stone-600">{c.personality}</p>
                    </div>
                    <button type="button" className={primaryButton} onClick={() => pick(c.id)} disabled={picking !== null}>
                      {picking === c.id ? s.mascot.picking : s.mascot.pick}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setConcepts([]);
                  setFewer(false);
                }}
                disabled={picking !== null}
              >
                {s.mascot.tryAgain}
              </button>
            </div>
          )}

          {makingNew && (
            <button
              type="button"
              className="py-2 text-sm text-stone-600 underline"
              onClick={() => {
                setMakingNew(false);
                setConcepts([]);
                setProblem(null);
              }}
              disabled={busy || picking !== null}
            >
              {s.mascot.keepCurrent}
            </button>
          )}
        </div>
      )}

      {problem && (
        <p role="alert" className={errorClass}>
          {problem}
        </p>
      )}
    </div>
  );
}
