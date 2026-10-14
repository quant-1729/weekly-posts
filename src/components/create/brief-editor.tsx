"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveBriefAction } from "@/app/(app)/create/actions";
import { currencyForCountry } from "@/lib/usps/currency";
import { chipClass, errorClass, inputClass, primaryButton } from "@/components/ui";
import type { EditorData } from "@/lib/briefs/editor-data";
import {
  DEFAULT_CTA,
  applyDescription,
  EDITOR_CHANNELS,
  blockLines,
  draftFromBrief,
  draftKey,
  draftToInput,
  emptyDraft,
  missingForNext,
  selectNewUsp,
  type EditorDraft,
  type EditorMissing,
} from "@/lib/briefs/editor-state";
import type { BriefFromTextResult, FilledField } from "@/lib/briefs/from-text";
import { CTA_KINDS, POST_TYPES, type BlockKey, type Brief, type CtaKind, type PostType } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";
import { languageOptions } from "@/lib/setup/languages";
import { NEEDS_CONFIRMATION, type Usp } from "@/lib/usps/types";
import { BlocksPicker } from "./blocks-picker";
import { EditorCard, pickClass } from "./card";
import { DatesPicker } from "./dates-picker";
import { DescribeBox } from "./describe-box";
import { NewUspCard } from "./new-usp-card";
import { PhotoPicker } from "./photo-picker";
import { QrPicker } from "./qr-picker";
import { StepBar } from "./steps";
import { UspPicker } from "./usp-picker";

const t = s.create;
const AUTOSAVE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/** The Details step of "Create a post": every field of the brief, autosaved as a draft, then "Next: Design". */
export function BriefEditor({ data, initialBrief }: { data: EditorData; initialBrief: Brief | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditorDraft>(() => (initialBrief ? draftFromBrief(initialBrief) : emptyDraft(data.defaults)));
  const [usps, setUsps] = useState<Usp[]>(data.usps);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [qrError, setQrError] = useState<string | null>(null);
  const [fromDesc, setFromDesc] = useState<ReadonlySet<FilledField>>(new Set());
  const [suggestion, setSuggestion] = useState<BriefFromTextResult["newUsp"]>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextProblem, setNextProblem] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<{ key: string; items: EditorMissing[] } | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const briefId = useRef<string | null>(initialBrief?.id ?? null);
  const savedKey = useRef<string>(initialBrief ? draftKey(draftFromBrief(initialBrief)) : "");
  const running = useRef<Promise<void> | null>(null);
  const brandId = data.brandId;

  /** Saves until what is on the server matches the screen. One save at a time; a failure stops the loop until the next change. */
  function flush(): Promise<void> {
    if (running.current) return running.current;
    const loop = async () => {
      for (;;) {
        const input = draftToInput(draftRef.current);
        if (!input) return;
        const key = JSON.stringify(input);
        if (key === savedKey.current) return;
        setSaveState("saving");
        const r = await saveBriefAction(brandId, briefId.current, input, "draft");
        if (!r.ok) {
          setFieldErrors(r.fieldErrors ?? {});
          setSaveState("error");
          return;
        }
        setFieldErrors({});
        setQrError(r.qrError);
        savedKey.current = key;
        if (briefId.current === null) {
          briefId.current = r.brief.id;
          // Same page, now addressed by its brief: a reload or a shared link finds it.
          window.history.replaceState(null, "", `/create/${r.brief.id}`);
        }
        setSaveState("saved");
      }
    };
    const p = loop().finally(() => {
      running.current = null;
    });
    running.current = p;
    return p;
  }

  const key = draftKey(draft);
  useEffect(() => {
    if (key === "null" || key === savedKey.current) return;
    const timer = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // flush only reads refs and stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (patch: Partial<EditorDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const dropFromDesc = (...fields: FilledField[]) =>
    setFromDesc((cur) => {
      if (!fields.some((f) => cur.has(f))) return cur;
      const next = new Set(cur);
      for (const f of fields) next.delete(f);
      return next;
    });

  function pickType(postType: PostType) {
    setDraft((d) => ({ ...d, postType, cta: d.ctaChosen ? d.cta : DEFAULT_CTA[postType] }));
    dropFromDesc("postType");
  }

  function setDates(next: { startsOn: string; endsOn: string }) {
    setDraft((d) => {
      const had = !!(d.startsOn || d.endsOn);
      const has = !!(next.startsOn || next.endsOn);
      const blocks = had === has ? d.blocks : { ...d.blocks, dates: has };
      return { ...d, ...next, openEnded: next.endsOn ? false : d.openEnded, blocks };
    });
    dropFromDesc("dates");
  }

  function setOpenEnded(on: boolean) {
    setDraft((d) => ({ ...d, openEnded: on, endsOn: on ? "" : d.endsOn }));
    dropFromDesc("dates");
  }

  function applyResult(r: BriefFromTextResult) {
    setDraft((d) => applyDescription(d, r));
    setFromDesc(new Set(r.filled));
    setSuggestion(r.newUsp);
    setQuestions(r.questions);
  }

  /** A selling point was just saved (inline form or accepted suggestion): list it and use it. */
  function acceptSuggestion(usp: Usp) {
    setUsps((cur) => [...cur, usp]);
    setDraft((d) => selectNewUsp(d, usp.id));
    setSuggestion(null);
  }

  const lines = useMemo(
    () => blockLines({ contacts: data.contacts, hasLogo: data.hasLogo, startsOn: draft.startsOn, endsOn: draft.endsOn }),
    [data.contacts, data.hasLogo, draft.startsOn, draft.endsOn],
  );
  const languages = useMemo(() => {
    const all = languageOptions();
    return draft.language && !all.some((l) => l.code === draft.language) ? [...all, { code: draft.language, label: draft.language }] : all;
  }, [draft.language]);
  const channelOptions = useMemo(() => [...EDITOR_CHANNELS, ...draft.channels.filter((c) => !(EDITOR_CHANNELS as readonly string[]).includes(c))], [draft.channels]);

  const missing: EditorMissing[] = missingForNext(draft, usps, NEEDS_CONFIRMATION);
  if (draft.endsOn && draft.endsOn < data.today) missing.push({ key: "dates", question: s.create.dates.ended });
  if (draft.startsOn && draft.endsOn && draft.startsOn > draft.endsOn) missing.push({ key: "dates", question: s.create.dates.startsAfter });
  if (qrError) missing.push({ key: "qr", question: qrError });
  // What the server still wants after "Next" (shown until the owner changes something).
  if (serverMissing?.key === key) for (const m of serverMissing.items) if (!missing.some((x) => x.question === m.question)) missing.push(m);
  const blocked = missing.length > 0 || Object.keys(fieldErrors).length > 0;

  const ctaNeed = ctaRequirement(draft, lines);

  async function next() {
    setNextBusy(true);
    setNextProblem(null);
    setServerMissing(null);
    await flush();
    const input = draftToInput(draftRef.current);
    if (!input) {
      setNextBusy(false);
      return;
    }
    const r = await saveBriefAction(brandId, briefId.current, input, "ready");
    if (!r.ok) {
      setNextBusy(false);
      setNextProblem(r.message);
      if (r.missing) setServerMissing({ key: draftKey(draftRef.current), items: r.missing });
      if (r.fieldErrors) setFieldErrors(r.fieldErrors);
      return;
    }
    briefId.current = r.brief.id;
    savedKey.current = draftKey(draftRef.current);
    router.push(`/create/${r.brief.id}/design`);
  }

  const saveText = saveState === "saving" ? t.save.saving : saveState === "saved" ? t.save.saved : saveState === "error" ? t.save.failed : "";
  const otherErrors = ["postType", "cta", "blocks", "photoId", "language", "channels", "notes"].flatMap((k) => (fieldErrors[k] ? [fieldErrors[k]] : []));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{t.title}</h1>
        <p className="text-stone-600">{t.intro}</p>
      </div>
      <StepBar current="details" />

      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="min-w-0 space-y-4">
          <DescribeBox brandId={brandId} onResult={applyResult} questions={questions} />
          {fromDesc.size > 1 && <p className="text-sm text-stone-600">{t.describe.filledFromHint}</p>}
          {suggestion && <NewUspCard brandId={brandId} suggestion={suggestion} onAccepted={acceptSuggestion} onDeclined={() => setSuggestion(null)} />}

          <EditorCard id="type" title={t.type.title} hint={t.type.hint} fromDescription={fromDesc.has("postType")}>
            <fieldset className="min-w-0">
              <legend className="sr-only">{t.type.title}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {POST_TYPES.map((type) => (
                  <label key={type} data-post-type={type} className={pickClass(draft.postType === type)}>
                    <input type="radio" name="post-type" className="mt-1 h-5 w-5 shrink-0" checked={draft.postType === type} onChange={() => pickType(type)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{t.type.options[type].label}</span>
                      <span className="block break-words text-sm text-stone-600">{t.type.options[type].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </EditorCard>

          <UspPicker
            brandId={brandId}
            usps={usps}
            primaryUspId={draft.primaryUspId}
            secondaryUspIds={draft.secondaryUspIds}
            channels={draft.channels}
            currency={currencyForCountry(data.country)}
            fromDescription={fromDesc.has("primaryUsp") || fromDesc.has("secondaryUsps")}
            error={fieldErrors.primaryUspId ?? fieldErrors.secondaryUspIds}
            onChange={(v) => {
              update(v);
              dropFromDesc("primaryUsp", "secondaryUsps");
            }}
            onUspsChange={setUsps}
            onUspAdded={acceptSuggestion}
          />

          <EditorCard id="cta" title={t.cta.title} hint={t.cta.hint} fromDescription={fromDesc.has("cta")}>
            <fieldset className="min-w-0">
              <legend className="sr-only">{t.cta.title}</legend>
              <div className="flex flex-wrap gap-2">
                {CTA_KINDS.map((cta: CtaKind) => (
                  <label key={cta} className={`${chipClass(draft.cta === cta)} flex cursor-pointer items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E4572E]`}>
                    <input
                      type="radio"
                      name="cta"
                      className="sr-only"
                      checked={draft.cta === cta}
                      onChange={() => {
                        update({ cta, ctaChosen: true });
                        dropFromDesc("cta");
                      }}
                    />
                    {t.cta.options[cta]}
                  </label>
                ))}
              </div>
            </fieldset>
            {ctaNeed && (
              <p data-cta-need className="text-sm text-amber-900">
                {ctaNeed}
              </p>
            )}
          </EditorCard>

          <BlocksPicker
            lines={lines}
            blocks={draft.blocks}
            fromDescription={fromDesc.has("blocks")}
            onToggle={(key: BlockKey, on) => {
              update({ blocks: { ...draft.blocks, [key]: on } });
              dropFromDesc("blocks");
            }}
          />

          <QrPicker brandId={brandId} qr={draft.qr} contacts={data.contacts} payment={data.payment} error={fieldErrors.qr ?? qrError} onChange={(qr) => update({ qr })} />

          <PhotoPicker brandId={brandId} photos={data.photos} photoId={draft.photoId} onChange={(photoId) => update({ photoId })} />

          <EditorCard id="language" title={t.language.title} hint={t.language.hint} fromDescription={fromDesc.has("language")}>
            <label htmlFor="post-language" className="sr-only">
              {t.language.title}
            </label>
            <select
              id="post-language"
              className={inputClass}
              value={draft.language}
              onChange={(e) => {
                update({ language: e.target.value });
                dropFromDesc("language");
              }}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </EditorCard>

          <DatesPicker
            startsOn={draft.startsOn}
            endsOn={draft.endsOn}
            today={data.today}
            fromDescription={fromDesc.has("dates")}
            startError={fieldErrors.startsOn}
            endError={fieldErrors.endsOn}
            openEnded={draft.openEnded && draft.postType === "offer"}
            canBeOpenEnded={draft.postType === "offer"}
            onOpenEndedChange={setOpenEnded}
            onChange={setDates}
          />

          <EditorCard id="channels" title={t.channels.title} hint={t.channels.hint}>
            <fieldset className="min-w-0">
              <legend className="sr-only">{t.channels.title}</legend>
              <div className="flex flex-wrap gap-2">
                {channelOptions.map((c) => {
                  const on = draft.channels.includes(c);
                  return (
                    <label key={c} className={`${chipClass(on)} flex cursor-pointer items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E4572E]`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={(e) => update({ channels: e.target.checked ? [...draft.channels, c] : draft.channels.filter((x) => x !== c) })}
                      />
                      {(t.channels.options as Record<string, string>)[c] ?? c}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </EditorCard>
        </div>

        <aside data-editor-summary aria-labelledby="check-title" className="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 lg:sticky lg:top-4">
          <h2 id="check-title" className="text-lg font-bold">
            {t.check.title}
          </h2>
          {missing.length === 0 ? (
            <p data-complete className="text-emerald-800">
              {t.check.allGood}
            </p>
          ) : (
            <ul data-missing className="list-disc space-y-1 pl-5 text-amber-950">
              {missing.map((m, i) => (
                <li key={`${m.key}-${i}`} className="break-words">
                  {m.question}
                </li>
              ))}
            </ul>
          )}
          {otherErrors.map((e) => (
            <p key={e} role="alert" className={errorClass}>
              {e}
            </p>
          ))}
          <p aria-live="polite" data-save-state={saveState} className="min-h-5 text-sm text-stone-600">
            {saveText}
          </p>
          <button type="button" data-next className={primaryButton} disabled={blocked || nextBusy} aria-disabled={blocked || nextBusy} onClick={() => void next()}>
            {nextBusy ? t.save.working : t.save.next}
          </button>
          {blocked && missing.length > 0 && <p className="text-sm text-stone-600">{t.check.blocked}</p>}
          {nextProblem && (
            <p role="alert" className={errorClass}>
              {nextProblem}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A one-line note when the chosen call to action has nothing to point at yet (not a blocker). */
function ctaRequirement(d: EditorDraft, lines: ReturnType<typeof blockLines>): string | null {
  if (!d.cta) return null;
  const n = s.create.cta.needs as Partial<Record<CtaKind, string>>;
  const shown = (key: BlockKey) => d.blocks[key] === true && lines.find((l) => l.key === key)?.text != null;
  if (d.cta === "call" && !shown("phone")) return n.call ?? null;
  if (d.cta === "whatsapp" && !shown("whatsapp")) return n.whatsapp ?? null;
  if (d.cta === "website" && !shown("website")) return n.website ?? null;
  if (d.cta === "visit" && !shown("address")) return n.visit ?? null;
  if (d.cta === "scan" && d.qr.mode === "none") return n.scan ?? null;
  return null;
}
