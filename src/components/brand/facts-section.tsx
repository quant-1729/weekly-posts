"use client";

import { useState, useTransition } from "react";
import { addFactAction, editFactAction, removeFactAction, rereadWebsiteAction } from "@/app/(app)/brand/actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { FACT_GROUPS, FACT_KINDS, groupOfKind, parseFact, type FactKind, type FactView } from "@/lib/memory/schema";
import { formatDate, rereadMessage, savedReadNote } from "@/lib/memory/messages";
import type { WebsiteInfo } from "@/lib/memory/website";
import { FactSource } from "./fact-source";

const t = s.brandV2.facts;
const errorText = t.errors as Record<string, string>;

interface Draft {
  kind: FactKind;
  label: string;
  value: string;
}
const EMPTY: Draft = { kind: "product", label: "", value: "" };

function FactForm({
  draft,
  setDraft,
  errors,
  pending,
  onSave,
  onCancel,
  idPrefix,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  errors: Record<string, string>;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
      <div>
        <label htmlFor={`${idPrefix}-kind`} className={labelClass}>
          {t.kindLabel}
        </label>
        <select
          id={`${idPrefix}-kind`}
          className={inputClass}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as FactKind })}
        >
          {FACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-label`} className={labelClass}>
          {t.labelLabel}
        </label>
        <input
          id={`${idPrefix}-label`}
          className={inputClass}
          value={draft.label}
          maxLength={120}
          placeholder={t.labelPlaceholder}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        {errors.label && (
          <p role="alert" className={errorClass}>
            {errorText[errors.label] ?? errorText.invalid}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-value`} className={labelClass}>
          {t.valueLabel}
        </label>
        <textarea
          id={`${idPrefix}-value`}
          className={inputClass}
          rows={3}
          maxLength={1000}
          value={draft.value}
          placeholder={t.valuePlaceholder}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        {errors.value && (
          <p role="alert" className={errorClass}>
            {errorText[errors.value] ?? errorText.invalid}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" className={primaryButton} disabled={pending} onClick={onSave}>
          {t.save}
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

/** The warning chip on a fact that promises a result. Stricter words for a regulated business. */
export function PromiseChip({ regulated }: { regulated: boolean }) {
  return (
    <p role="note" data-promise={regulated ? "regulated" : "plain"} className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-amber-300">
      {regulated ? t.promiseRegulated : t.promiseOther}
    </p>
  );
}

/** One fact: value, label, source badge, promise chip and its buttons. */
export function FactItem({
  fact,
  regulated,
  onEdit,
  onRemove,
  disabled,
}: {
  fact: FactView;
  regulated: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="space-y-1 rounded-xl border border-stone-200 p-3" data-fact-id={fact.id}>
      <p className="break-words font-medium">{fact.value}</p>
      {fact.label && <p className="text-sm text-stone-600">{fact.label}</p>}
      <FactSource fact={fact} />
      {fact.outcomePromise && <PromiseChip regulated={regulated} />}
      {(onEdit || onRemove) && (
        <div className="flex gap-4 pt-1">
          {onEdit && (
            <button type="button" className="min-h-10 text-sm underline" disabled={disabled} onClick={onEdit}>
              {t.edit}
            </button>
          )}
          {onRemove && (
            <button type="button" className="min-h-10 text-sm text-red-700 underline" disabled={disabled} onClick={onRemove}>
              {t.remove}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Facts grouped by kind, each with its source; add, edit, remove; and read the website again. */
export function FactsSection({
  brandId,
  facts,
  regulated,
  website,
}: {
  brandId: string;
  facts: FactView[];
  regulated: boolean;
  website: WebsiteInfo;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [url, setUrl] = useState(website.url ?? "");
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<{ ok: boolean; text: string } | null>(null);

  // A new address saved on the server (after a re-read) replaces what is typed.
  const [seenUrl, setSeenUrl] = useState(website.url);
  if (seenUrl !== website.url) {
    setSeenUrl(website.url);
    setUrl(website.url ?? "");
  }

  function open(next: { id: string | null; draft: Draft }) {
    setError(null);
    setErrors({});
    setAdding(next.id === null);
    setEditingId(next.id);
    setDraft(next.draft);
  }
  function close() {
    setAdding(false);
    setEditingId(null);
    setErrors({});
  }

  function save() {
    const parsed = parseFact(draft);
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors as Record<string, string>);
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const r = editingId ? await editFactAction(brandId, editingId, draft) : await addFactAction(brandId, draft);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.message);
        return;
      }
      close();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeFactAction(brandId, id);
      if (!r.ok) setError(r.message);
    });
  }

  function reread() {
    setReadResult(null);
    setReading(true);
    startTransition(async () => {
      try {
        const r = await rereadWebsiteAction(brandId, url);
        if (!r.ok) setReadResult({ ok: false, text: r.message });
        else setReadResult({ ok: r.outcome.status === "ok" || r.outcome.status === "partial", text: rereadMessage(r.outcome) });
      } catch {
        setReadResult({ ok: false, text: s.errors.generic });
      } finally {
        setReading(false);
      }
    });
  }

  const byGroup = FACT_GROUPS.map((g) => ({ group: g, items: facts.filter((f) => groupOfKind(f.kind) === g) })).filter((g) => g.items.length > 0);
  const readLine = website.readAt ? fill(t.reread.lastRead, { date: formatDate(website.readAt) }) : website.url ? t.reread.neverRead : t.reread.none;

  return (
    <div className="space-y-5">
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      <div className="space-y-2 rounded-xl border border-stone-200 p-3">
        <label htmlFor="website-url" className={labelClass}>
          {t.reread.label}
        </label>
        <p className={hintClass}>{t.reread.hint}</p>
        <input
          id="website-url"
          className={inputClass}
          inputMode="url"
          autoComplete="url"
          value={url}
          maxLength={2000}
          placeholder={s.setupV2.website.placeholder}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-sm text-stone-500">{readLine}</p>
        {!readResult && savedReadNote(website.status, website.reason) && <p className="text-sm text-amber-900">{savedReadNote(website.status, website.reason)}</p>}
        <button type="button" className={secondaryButton} disabled={reading || pending} onClick={reread}>
          {reading ? t.reread.reading : website.url ? t.reread.button : t.reread.buttonFirst}
        </button>
        <div role="status" aria-live="polite">
          {readResult && <p className={readResult.ok ? "text-sm text-emerald-800" : "text-sm text-amber-900"}>{readResult.text}</p>}
        </div>
      </div>

      {facts.length === 0 && !adding && <p className="text-[14px] leading-5 text-desc">{t.empty}</p>}

      {byGroup.map(({ group, items }) => (
        <div key={group} className="space-y-2">
          <h3 className="text-card-title text-title">
            {t.groups[group]} <span className="text-sm font-normal text-stone-500">({items.length})</span>
          </h3>
          <ul className="space-y-2">
            {items.map((f) =>
              editingId === f.id ? (
                <li key={f.id}>
                  <FactForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} onSave={save} onCancel={close} idPrefix={`edit-${f.id}`} />
                </li>
              ) : (
                <FactItem
                  key={f.id}
                  fact={f}
                  regulated={regulated}
                  disabled={pending}
                  onEdit={() => open({ id: f.id, draft: { kind: f.kind, label: f.label ?? "", value: f.value } })}
                  onRemove={() => remove(f.id)}
                />
              ),
            )}
          </ul>
        </div>
      ))}

      {adding ? (
        <FactForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} onSave={save} onCancel={close} idPrefix="add-fact" />
      ) : (
        <button type="button" className={secondaryButton} onClick={() => open({ id: null, draft: EMPTY })}>
          {t.add}
        </button>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
