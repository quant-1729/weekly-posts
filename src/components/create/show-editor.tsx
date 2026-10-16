"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveBriefAction } from "@/app/(app)/create/actions";
import { alertClass, chipTwoClass, linkButton, outlineButton, primaryButton } from "@/components/ui";
import type { EditorData } from "@/lib/briefs/editor-data";
import { blockLines, draftFromBrief, type QrDraft } from "@/lib/briefs/editor-state";
import type { Blocks, BlockKey, Brief, QrSpec } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";
import { QrPicker } from "./qr-picker";
import { SaveStatus, StepFooter } from "./step-footer";
import { StepBar } from "./steps";

const t = s.create;
const AUTOSAVE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/** What the brief service gets from this step: only the blocks and the QR. A link QR without a link yet is "no QR". */
function toInput(blocks: Blocks, qr: QrDraft): { blocks: Blocks; qr: QrSpec | null } {
  let spec: QrSpec | null = null;
  if (qr.mode === "link" && qr.url.trim()) spec = { kind: "link", target: qr.target, url: qr.url.trim() };
  if (qr.mode === "payment" && qr.paymentId) spec = { kind: "payment", paymentId: qr.paymentId };
  return { blocks, qr: spec };
}

/**
 * "What to show on the post": the contact details to put on the post, as small toggle chips that
 * show the exact text, and the optional QR code. Autosaved as a draft; "Next: Design" saves the
 * brief as ready (the server checks it is complete) and goes on.
 */
export function ShowEditor({ data, brief }: { data: EditorData; brief: Brief }) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Blocks>(brief.blocks);
  const [qr, setQr] = useState<QrDraft>(() => draftFromBrief(brief).qr);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [qrError, setQrError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [nextBusy, setNextBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [tried, setTried] = useState(false);

  const stateRef = useRef({ blocks, qr });
  stateRef.current = { blocks, qr };
  const savedKey = useRef(JSON.stringify(toInput(brief.blocks, draftFromBrief(brief).qr)));
  const running = useRef<Promise<void> | null>(null);
  const brandId = data.brandId;

  function flush(): Promise<void> {
    if (running.current) return running.current;
    const loop = async () => {
      for (;;) {
        const input = toInput(stateRef.current.blocks, stateRef.current.qr);
        const key = JSON.stringify(input);
        if (key === savedKey.current) return;
        setSaveState("saving");
        const r = await saveBriefAction(brandId, brief.id, input, "draft");
        if (!r.ok) {
          setFieldErrors(r.fieldErrors ?? {});
          setSaveState("error");
          return;
        }
        setFieldErrors({});
        setQrError(r.qrError);
        savedKey.current = key;
        setSaveState("saved");
      }
    };
    const p = loop().finally(() => {
      running.current = null;
    });
    running.current = p;
    return p;
  }

  const key = JSON.stringify(toInput(blocks, qr));
  useEffect(() => {
    if (key === savedKey.current) return;
    const timer = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // flush only reads refs and stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The dates block is not offered here; the brief's own dates (if any) are not shown or changed.
  const lines = useMemo(
    () => blockLines({ contacts: data.contacts, hasLogo: data.hasLogo, startsOn: brief.startsOn ?? "", endsOn: brief.endsOn ?? "" }).filter((l) => l.key !== "dates"),
    [data.contacts, data.hasLogo, brief.startsOn, brief.endsOn],
  );
  const available = lines.filter((l) => l.text !== null);
  const hasMore = lines.some((l) => l.text === null);

  const linkMissing = qr.mode === "link" && !qr.url.trim();
  const qrShown = fieldErrors.qr ?? qrError ?? (tried && linkMissing ? t.qr.errors.empty : null);

  async function next() {
    setProblem(null);
    setMissing([]);
    if (linkMissing) {
      setTried(true);
      document.getElementById("qr-url")?.focus();
      return;
    }
    setNextBusy(true);
    await flush();
    const { blocks: b, qr: q } = stateRef.current;
    const r = await saveBriefAction(brandId, brief.id, toInput(b, q), "ready");
    if (!r.ok) {
      setNextBusy(false);
      setProblem(r.message);
      if (r.missing) setMissing(r.missing.map((m) => m.question));
      if (r.fieldErrors) setFieldErrors(r.fieldErrors);
      return;
    }
    savedKey.current = JSON.stringify(toInput(b, q));
    router.push(`/create/${brief.id}/design`);
  }

  const saveText = saveState === "saving" ? t.save.saving : saveState === "saved" ? t.save.saved : saveState === "error" ? t.save.failed : "";
  const toggle = (k: BlockKey, on: boolean) => setBlocks((cur) => ({ ...cur, [k]: on }));

  return (
    <div className="mx-auto w-full max-w-page-sm space-y-4">
      <StepBar current="show" />
      <h1 className="text-section text-title">{t.show.title}</h1>

      <section data-editor-card="blocks" aria-label={t.show.title} className="min-w-0 space-y-2">
        <ul className="flex flex-wrap gap-2">
          {available.map((line) => {
            const on = blocks[line.key] === true;
            return (
              <li key={line.key} data-block={line.key} className="min-w-0 max-w-full">
                <label className={`${chipTwoClass(on)} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggle(line.key, e.target.checked)} />
                  <span>{line.label}</span>
                  <span data-block-text className={`max-w-full break-words text-note font-normal ${on ? "text-white/80" : "text-desc"}`}>
                    {line.text}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {hasMore && (
          <p>
            <Link href="/brand#contacts" className={linkButton}>
              {t.blocks.addMore}
            </Link>
          </p>
        )}
      </section>

      <QrPicker brandId={brandId} qr={qr} contacts={data.contacts} payment={data.payment} error={qrShown} onChange={setQr} />

      <StepFooter
        status={<SaveStatus state={saveState} text={saveText} />}
        problems={
          problem ? (
            <div role="alert" className={`space-y-1 ${alertClass("err")}`}>
              <p className="text-err-tx">{problem}</p>
              {missing.length > 0 && (
                <ul data-missing className="list-disc space-y-1 pl-5">
                  {missing.map((m) => (
                    <li key={m} className="break-words">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
              {missing.length > 0 && (
                <Link href={`/create/${brief.id}`} className={linkButton}>
                  {t.show.toDetails}
                </Link>
              )}
            </div>
          ) : null
        }
      >
        <Link href={`/create/${brief.id}`} className={outlineButton}>
          {t.save.back}
        </Link>
        <button type="button" data-next className={primaryButton} disabled={nextBusy} aria-disabled={nextBusy} onClick={() => void next()}>
          {nextBusy ? t.save.working : t.save.nextDesign}
        </button>
      </StepFooter>
    </div>
  );
}
