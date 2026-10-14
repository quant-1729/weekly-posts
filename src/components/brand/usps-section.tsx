"use client";

import { useState, useTransition } from "react";
import {
  confirmUspAction,
  createUspAction,
  removeUspAction,
  reorderUspsAction,
  updateUspAction,
} from "@/app/(app)/brand/details-actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { s } from "@/lib/i18n/strings";
import { parseUsp } from "@/lib/usps/schema";
import { detailsFromForm, detailsSummary, fieldOfError, formFromDetails, suggestTitle, USP_FIELDS, type FieldDef, type FormValues } from "@/lib/usps/form";
import { NEEDS_CONFIRMATION, USP_KINDS, USP_TITLE_MAX, type Usp, type UspKind } from "@/lib/usps/types";

const t = s.usps;
const fieldLabels = t.fields as Record<string, string>;
const errorText = t.errors as Record<string, string>;

const textOf = (code: string) => errorText[code] ?? (code.includes(" ") ? code : errorText.invalid);

export interface Draft {
  kind: UspKind;
  title: string;
  values: FormValues;
}

export function emptyDraft(currency: string): Draft {
  return { kind: "discount", title: "", values: { currency, upTo: "" } };
}

function Field({
  def,
  value,
  error,
  onChange,
  id,
}: {
  def: FieldDef;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  id: string;
}) {
  if (def.type === "bool") {
    return (
      <label htmlFor={id} className="flex min-h-12 items-center gap-3 md:col-span-2">
        <input id={id} type="checkbox" className="h-5 w-5" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} />
        <span>{fieldLabels[def.key]}</span>
      </label>
    );
  }
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {fieldLabels[def.key]}
      </label>
      <input
        id={id}
        className={inputClass}
        type={def.type === "date" ? "date" : "text"}
        inputMode={def.type === "number" ? "decimal" : undefined}
        maxLength={def.type === "currency" ? 3 : (def.max ?? 120)}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(def.type === "currency" ? e.target.value.toUpperCase() : e.target.value)}
      />
      {error && (
        <p role="alert" className={errorClass}>
          {textOf(error)}
        </p>
      )}
    </div>
  );
}

export function UspForm({
  draft,
  setDraft,
  errors,
  pending,
  onSave,
  onCancel,
  idPrefix,
  editing,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  errors: Record<string, string>;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  idPrefix: string;
  editing: boolean;
}) {
  const details = detailsFromForm(draft.kind, draft.values);
  const suggestion = suggestTitle(draft.kind, details);
  const fields = USP_FIELDS[draft.kind];
  const set = (key: string, v: string) => setDraft({ ...draft, values: { ...draft.values, [key]: v } });
  return (
    <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-kind`} className={labelClass}>
            {t.kindLabel}
          </label>
          <select
            id={`${idPrefix}-kind`}
            className={inputClass}
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as UspKind;
              setDraft({ kind, title: draft.title, values: { currency: draft.values.currency ?? "", upTo: "" } });
            }}
          >
            {USP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-title`} className={labelClass}>
            {t.titleLabel}
          </label>
          <input
            id={`${idPrefix}-title`}
            className={inputClass}
            value={draft.title}
            maxLength={USP_TITLE_MAX}
            placeholder={suggestion}
            aria-invalid={errors.title ? true : undefined}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <p className={hintClass}>{t.titleHint}</p>
          {errors.title && (
            <p role="alert" className={errorClass}>
              {textOf(errors.title)}
            </p>
          )}
        </div>
        {fields.map((f) => (
          <Field key={f.key} id={`${idPrefix}-${f.key}`} def={f} value={draft.values[f.key] ?? ""} error={errors[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
      </div>
      {errors.details && (
        <p role="alert" className={errorClass}>
          {textOf(errors.details)}
        </p>
      )}
      {editing && NEEDS_CONFIRMATION.has(draft.kind) && <p className={hintClass}>{t.confirm.editWarning}</p>}
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

function UspItem({
  usp,
  index,
  count,
  disabled,
  onEdit,
  onRemove,
  onMove,
  onConfirm,
}: {
  usp: Usp;
  index: number;
  count: number;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onConfirm: (v: boolean) => void;
}) {
  const needs = NEEDS_CONFIRMATION.has(usp.kind);
  const summary = detailsSummary(usp.kind, usp.details as Record<string, unknown>);
  return (
    <li className="space-y-1 rounded-xl border border-stone-200 p-3" data-usp-id={usp.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{usp.title}</p>
          <p className="text-sm text-stone-600">
            {t.kinds[usp.kind]}
            {summary ? ` · ${summary}` : ""}
          </p>
        </div>
        <span
          data-source={usp.source}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${usp.source === "website" ? "bg-sky-50 text-sky-900 ring-1 ring-sky-200" : "bg-stone-100 text-stone-700"}`}
        >
          {t.source[usp.source]}
        </span>
      </div>
      {needs && (
        <div className="pt-1">
          <label className="flex min-h-10 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={usp.confirmed} disabled={disabled} onChange={(e) => onConfirm(e.target.checked)} />
            <span>{t.confirm.label}</span>
          </label>
          <p role="note" className={usp.confirmed ? "text-sm text-emerald-800" : "text-sm text-amber-900"}>
            {usp.confirmed ? t.confirm.done : t.confirm.needed}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-4 pt-1">
        <button type="button" className="min-h-10 text-sm underline" disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          {t.moveUp}
        </button>
        <button type="button" className="min-h-10 text-sm underline" disabled={disabled || index === count - 1} onClick={() => onMove(1)}>
          {t.moveDown}
        </button>
        <button type="button" className="min-h-10 text-sm underline" disabled={disabled} onClick={onEdit}>
          {t.edit}
        </button>
        <button type="button" className="min-h-10 text-sm text-red-700 underline" disabled={disabled} onClick={onRemove}>
          {t.remove}
        </button>
      </div>
    </li>
  );
}

/** The brand's selling points: list, add and edit by kind, reorder, remove, and confirm claims that need it. */
export function UspsSection({ brandId, usps, defaultCurrency }: { brandId: string; usps: Usp[]; defaultCurrency: string }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultCurrency));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(id: string | null, d: Draft) {
    setError(null);
    setErrors({});
    setAdding(id === null);
    setEditingId(id);
    setDraft(d);
  }
  function close() {
    setAdding(false);
    setEditingId(null);
    setErrors({});
  }

  function save() {
    const details = detailsFromForm(draft.kind, draft.values);
    const title = draft.title.trim() || suggestTitle(draft.kind, details);
    const input = { kind: draft.kind, title, details };
    const parsed = parseUsp(input);
    if (!parsed.ok) {
      const next: Record<string, string> = {};
      for (const [path, code] of Object.entries(parsed.fieldErrors)) {
        const key = fieldOfError(path);
        if (!(key in next)) next[key] = code;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const r = editingId ? await updateUspAction(brandId, editingId, input) : await createUspAction(brandId, input);
      if (!r.ok) {
        const next: Record<string, string> = {};
        for (const [path, text] of Object.entries(r.fieldErrors ?? {})) {
          const key = fieldOfError(path);
          if (!(key in next)) next[key] = text;
        }
        setErrors(next);
        setError(r.message);
        return;
      }
      close();
    });
  }

  function act(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? t.errors.generic);
    });
  }

  function move(index: number, dir: -1 | 1) {
    const ids = usps.map((u) => u.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + dir, 0, x);
    act(() => reorderUspsAction(brandId, ids));
  }

  return (
    <div className="space-y-4">
      <p className="text-stone-600">{t.intro}</p>
      {usps.length === 0 && !adding && <p className="text-stone-600">{t.empty}</p>}
      <ul className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-2 lg:space-y-0">
        {usps.map((u, i) =>
          editingId === u.id ? (
            <li key={u.id} className="lg:col-span-2">
              <UspForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} onSave={save} onCancel={close} idPrefix={`edit-usp-${u.id}`} editing />
            </li>
          ) : (
            <UspItem
              key={u.id}
              usp={u}
              index={i}
              count={usps.length}
              disabled={pending}
              onEdit={() => {
                const values = formFromDetails(u.kind, u.details as Record<string, unknown>);
                open(u.id, { kind: u.kind, title: u.title, values: { ...values, currency: values.currency || defaultCurrency } });
              }}
              onRemove={() => act(() => removeUspAction(brandId, u.id))}
              onMove={(dir) => move(i, dir)}
              onConfirm={(v) => act(() => confirmUspAction(brandId, u.id, v))}
            />
          ),
        )}
      </ul>
      {adding ? (
        <UspForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} onSave={save} onCancel={close} idPrefix="add-usp" editing={false} />
      ) : (
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => open(null, emptyDraft(defaultCurrency))}>
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
