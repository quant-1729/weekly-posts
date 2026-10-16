"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveBriefAction } from "@/app/(app)/create/actions";
import { takeDescription } from "@/components/create/handoff";
import { badge, chipClass, errorClass, hintClass, inputClass, primaryButton } from "@/components/ui";
import type { EditorData } from "@/lib/briefs/editor-data";
import {
  applyDescription,
  EDITOR_CHANNELS,
  draftFromBrief,
  draftKey,
  draftToInput,
  emptyDraft,
  setContentFormat,
  stepSlides,
  tickedTypes,
  toggleAllChannels,
  toggleAllTypes,
  toggleType,
  type EditorDraft,
} from "@/lib/briefs/editor-state";
import type { BriefFromTextResult, FilledField } from "@/lib/briefs/from-text";
import { POST_TYPES, type Brief, type PostType } from "@/lib/briefs/types";
import { s } from "@/lib/i18n/strings";
import { languageOptions } from "@/lib/setup/languages";
import { EditorCard, pickClass } from "./card";
import { DescribeBox } from "./describe-box";
import { FormatPicker } from "./format-picker";
import { PhotoPicker } from "./photo-picker";
import { SaveStatus, StepFooter } from "./step-footer";
import { StepBar } from "./steps";

const t = s.create;
const AUTOSAVE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The Details step of "Create a post": the description, the post type, a supporting photo, the
 * language and the channels. Autosaved as a draft; "Next" goes to "What to show on the post".
 */
export function BriefEditor({ data, initialBrief }: { data: EditorData; initialBrief: Brief | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<EditorDraft>(() => (initialBrief ? draftFromBrief(initialBrief) : emptyDraft(data.defaults)));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [fromDesc, setFromDesc] = useState<ReadonlySet<FilledField>>(new Set());
  const [questions, setQuestions] = useState<string[]>([]);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextProblem, setNextProblem] = useState<string | null>(null);
  /** Set once "Next" was pressed without a type or description; the inline lines go away as soon as the owner supplies them. */
  const [tried, setTried] = useState(false);

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

  // Home hands over the owner's first words (sessionStorage, read once). Only for a new post, and only into an empty box.
  useEffect(() => {
    if (initialBrief) return;
    const text = takeDescription();
    // Reading sessionStorage (an external system) once on mount; it cannot be read during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (text) setDraft((d) => (d.notes.trim() ? d : { ...d, notes: text.slice(0, 2000) }));
  }, [initialBrief]);

  const update = (patch: Partial<EditorDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const dropFromDesc = (...fields: FilledField[]) =>
    setFromDesc((cur) => {
      if (!fields.some((f) => cur.has(f))) return cur;
      const next = new Set(cur);
      for (const f of fields) next.delete(f);
      return next;
    });

  /** The call to action is not asked any more; the main type starts it from its default so the copy still gets one. */
  function tickType(type: PostType) {
    setDraft((d) => toggleType(d, type));
    dropFromDesc("postType");
  }
  function tickAllTypes() {
    setDraft((d) => toggleAllTypes(d));
    dropFromDesc("postType");
  }

  function applyResult(r: BriefFromTextResult) {
    setDraft((d) => applyDescription(d, r));
    setFromDesc(new Set(r.filled));
    setQuestions(r.questions);
  }

  const languages = useMemo(() => {
    const all = languageOptions();
    return draft.language && !all.some((l) => l.code === draft.language) ? [...all, { code: draft.language, label: draft.language }] : all;
  }, [draft.language]);
  const channelOptions = useMemo(() => [...EDITOR_CHANNELS, ...draft.channels.filter((c) => !(EDITOR_CHANNELS as readonly string[]).includes(c))], [draft.channels]);

  const ticked = tickedTypes(draft);
  const typeError = tried && !draft.postType ? t.type.missing : null;
  const notesError = fieldErrors.notes ?? (tried && !draft.notes.trim() ? t.describe.empty : null);

  async function next() {
    setNextProblem(null);
    if (!draft.postType) {
      setTried(true);
      document.getElementById("type")?.scrollIntoView({ block: "center" });
      document.querySelector<HTMLInputElement>('input[name="post-type"]')?.focus();
      return;
    }
    if (!draft.notes.trim()) {
      setTried(true);
      const box = document.getElementById("describe-text");
      box?.scrollIntoView({ block: "center" });
      box?.focus();
      return;
    }
    setNextBusy(true);
    await flush();
    if (!briefId.current || savedKey.current !== draftKey(draftRef.current)) {
      setNextBusy(false);
      setNextProblem(t.save.failed);
      return;
    }
    router.push(`/create/${briefId.current}/show`);
  }

  const saveText = saveState === "saving" ? t.save.saving : saveState === "saved" ? t.save.saved : saveState === "error" ? t.save.failed : "";
  const otherErrors = ["postType", "contentFormat", "slideCount", "photoId", "language", "channels"].flatMap((k) => (fieldErrors[k] ? [fieldErrors[k]] : []));

  return (
    <div className="mx-auto w-full max-w-page-sm space-y-4">
      <StepBar current="details" />

      <FormatPicker
        format={draft.contentFormat}
        slides={draft.slideCount}
        onFormat={(f) => setDraft((d) => setContentFormat(d, f))}
        onSlides={(n) => setDraft((d) => stepSlides(d, n > d.slideCount ? 1 : -1))}
      />

      <DescribeBox brandId={brandId} value={draft.notes} onChange={(notes) => update({ notes })} error={notesError} onResult={applyResult} questions={questions} />
      {fromDesc.size > 1 && <p className={`${hintClass} !mb-0`}>{t.describe.filledFromHint}</p>}

      <EditorCard id="type" title={t.type.title} hint={t.type.hint} fromDescription={fromDesc.has("postType")}>
        <fieldset className="min-w-0">
          <legend className="sr-only">{t.type.title}</legend>
          <SelectAll id="type-select-all" label={t.type.selectAll} controls="type-options" checked={ticked.length === POST_TYPES.length} some={ticked.length > 0} onChange={tickAllTypes} />
          <div id="type-options" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {POST_TYPES.map((type) => (
              <label key={type} data-post-type={type} className={pickClass(ticked.includes(type))}>
                <input type="checkbox" name="post-type" className="mt-0.5 shrink-0" checked={ticked.includes(type)} onChange={() => tickType(type)} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-ui text-title">
                    {t.type.options[type].label}
                    {draft.postType === type && (
                      <span data-main-badge className={badge("coral")}>
                        {t.type.main}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block break-words text-note text-desc">{t.type.options[type].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {typeError && (
          <p role="alert" data-type-error className={errorClass}>
            {typeError}
          </p>
        )}
      </EditorCard>

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

      <EditorCard id="channels" title={t.channels.title} hint={t.channels.hint}>
        <fieldset className="min-w-0">
          <legend className="sr-only">{t.channels.title}</legend>
          <SelectAll
            id="channels-select-all"
            label={t.channels.selectAll}
            controls="channel-options"
            checked={channelOptions.every((c) => draft.channels.includes(c))}
            some={channelOptions.some((c) => draft.channels.includes(c))}
            onChange={() => update({ channels: toggleAllChannels(draft.channels, channelOptions) })}
          />
          <div id="channel-options" className="flex flex-wrap gap-2">
            {channelOptions.map((c) => {
              const on = draft.channels.includes(c);
              return (
                <label key={c} className={`${chipClass(on)} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral`}>
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

      <StepFooter
        status={<SaveStatus state={saveState} text={saveText} />}
        problems={
          <>
            {otherErrors.map((e) => (
              <p key={e} role="alert" className={errorClass}>
                {e}
              </p>
            ))}
            {nextProblem && (
              <p role="alert" className={errorClass}>
                {nextProblem}
              </p>
            )}
          </>
        }
      >
        <button type="button" data-next className={primaryButton} disabled={nextBusy} aria-disabled={nextBusy} onClick={() => void next()}>
          {nextBusy ? t.save.working : t.save.next}
        </button>
      </StepFooter>
    </div>
  );
}

/** The "Select all" row at the top of a group of checkboxes: ticked when all are, half-ticked when only some are. */
function SelectAll({ id, label, controls, checked, some, onChange }: { id: string; label: string; controls: string; checked: boolean; some: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !checked;
  }, [some, checked]);
  return (
    <label htmlFor={id} className="mb-2 inline-flex cursor-pointer items-center gap-2 text-ui text-title focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral">
      <input ref={ref} id={id} type="checkbox" data-select-all aria-controls={controls} className="shrink-0" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
