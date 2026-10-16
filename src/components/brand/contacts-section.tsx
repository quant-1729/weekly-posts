"use client";

import { useState, useTransition } from "react";
import {
  checkContactLinkAction,
  createContactAction,
  removeContactAction,
  setContactDefaultAction,
  updateContactAction,
} from "@/app/(app)/brand/details-actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { DAY_KEYS, CONTACT_KINDS, LINK_KINDS, type ContactKind, type ContactPoint, type DayKey, type TimeRange } from "@/lib/contacts/types";
import { fill, s } from "@/lib/i18n/strings";

const t = s.contacts;
const fieldLabels = t.fields as Record<string, string>;

interface DayDraft {
  open: boolean;
  from: string;
  to: string;
  /** Further ranges the editor does not show (a lunch break); kept as they are. */
  rest: TimeRange[];
}
type DaysDraft = Record<DayKey, DayDraft>;

interface Draft {
  kind: ContactKind;
  value: string;
  label: string;
  full: string;
  isDefault: boolean;
  days: DaysDraft;
}

const closedDay = (): DayDraft => ({ open: false, from: "09:00", to: "17:00", rest: [] });
const emptyDays = (): DaysDraft => Object.fromEntries(DAY_KEYS.map((d) => [d, closedDay()])) as DaysDraft;
const emptyDraft = (kind: ContactKind = "phone"): Draft => ({ kind, value: "", label: "", full: "", isDefault: true, days: emptyDays() });

function daysFromDetails(details: Record<string, unknown>): DaysDraft {
  const out = emptyDays();
  const src = details.days as Partial<Record<DayKey, TimeRange[]>> | undefined;
  if (!src) return out;
  for (const d of DAY_KEYS) {
    const ranges = src[d] ?? [];
    if (ranges.length > 0) out[d] = { open: true, from: ranges[0].open, to: ranges[0].close, rest: ranges.slice(1) };
  }
  return out;
}

function daysPayload(days: DaysDraft): Record<DayKey, TimeRange[]> {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, days[d].open ? [{ open: days[d].from, close: days[d].to }, ...days[d].rest] : []])) as Record<DayKey, TimeRange[]>;
}

function inputOf(d: Draft) {
  if (d.kind === "hours") return { kind: d.kind, days: daysPayload(d.days), isDefault: d.isDefault };
  return { kind: d.kind, value: d.value, label: d.label, full: d.full, isDefault: d.isDefault };
}

function countryName(code: string | null): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function ContactForm({
  draft,
  setDraft,
  errors,
  pending,
  editing,
  country,
  onSave,
  onCancel,
  idPrefix,
  importedHours,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  errors: Record<string, string>;
  pending: boolean;
  editing: boolean;
  country: string | null;
  onSave: () => void;
  onCancel: () => void;
  idPrefix: string;
  importedHours: boolean;
}) {
  const kind = draft.kind;
  const err = (key: string) =>
    errors[key] ? (
      <p role="alert" className={errorClass}>
        {errors[key]}
      </p>
    ) : null;
  const setDay = (d: DayKey, patch: Partial<DayDraft>) => setDraft({ ...draft, days: { ...draft.days, [d]: { ...draft.days[d], ...patch } } });
  const showLabel = kind === "custom_link" || kind === "booking";
  return (
    <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
      <div>
        <label htmlFor={`${idPrefix}-kind`} className={labelClass}>
          {t.kindLabel}
        </label>
        <select
          id={`${idPrefix}-kind`}
          className={inputClass}
          value={kind}
          disabled={editing}
          onChange={(e) => setDraft({ ...emptyDraft(e.target.value as ContactKind), isDefault: draft.isDefault })}
        >
          {CONTACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </div>

      {kind === "hours" ? (
        <div className="space-y-2">
          {importedHours && <p className={hintClass}>{t.importedHours}</p>}
          <ul className="space-y-1">
            {DAY_KEYS.map((d) => (
              <li key={d} className="grid grid-cols-[7rem_1fr] items-center gap-2 md:grid-cols-[9rem_6rem_1fr]">
                <label className="flex min-h-12 items-center gap-2">
                  <input type="checkbox" className="h-5 w-5" checked={draft.days[d].open} onChange={(e) => setDay(d, { open: e.target.checked })} />
                  <span>{t.hours.days[d]}</span>
                </label>
                {draft.days[d].open ? (
                  <div className="col-span-1 flex items-center gap-2 md:col-span-2">
                    <input
                      type="time"
                      aria-label={`${t.hours.days[d]} ${t.hours.from}`}
                      className={inputClass}
                      value={draft.days[d].from}
                      onChange={(e) => setDay(d, { from: e.target.value })}
                    />
                    <span>{t.hours.to}</span>
                    <input
                      type="time"
                      aria-label={`${t.hours.days[d]} ${t.hours.to}`}
                      className={inputClass}
                      value={draft.days[d].to}
                      onChange={(e) => setDay(d, { to: e.target.value })}
                    />
                  </div>
                ) : (
                  <span className="text-stone-500 md:col-span-2">{t.hours.closed}</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="min-h-10 text-sm underline"
            onClick={() => setDraft({ ...draft, days: Object.fromEntries(DAY_KEYS.map((d) => [d, { ...draft.days.mon }])) as DaysDraft })}
          >
            {t.hours.copyMonday}
          </button>
          {err("days")}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-value`} className={labelClass}>
              {fieldLabels[kind]}
            </label>
            <input
              id={`${idPrefix}-value`}
              className={inputClass}
              value={draft.value}
              maxLength={kind === "address" ? 120 : 300}
              inputMode={kind === "phone" || kind === "whatsapp" ? "tel" : kind === "email" ? "email" : kind === "address" ? "text" : "url"}
              autoComplete="off"
              aria-invalid={errors.value ? true : undefined}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            />
            {(kind === "phone" || kind === "whatsapp") && country && <p className={hintClass}>{fill(t.hints.phone, { country: countryName(country) })}</p>}
            {kind === "address" && <p className={hintClass}>{t.hints.address}</p>}
            {err("value")}
          </div>
          {kind === "address" && (
            <div>
              <label htmlFor={`${idPrefix}-full`} className={labelClass}>
                {t.fields.full}
              </label>
              <textarea id={`${idPrefix}-full`} className={inputClass} rows={2} maxLength={500} value={draft.full} onChange={(e) => setDraft({ ...draft, full: e.target.value })} />
              {err("full")}
            </div>
          )}
          {showLabel && (
            <div>
              <label htmlFor={`${idPrefix}-label`} className={labelClass}>
                {kind === "custom_link" ? t.fields.label : t.fields.labelOptional}
              </label>
              <input id={`${idPrefix}-label`} className={inputClass} maxLength={120} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              {err("label")}
            </div>
          )}
        </div>
      )}

      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
        <span>{t.showOnPosts}</span>
      </label>
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

function ContactItem({
  c,
  disabled,
  checking,
  checkNote,
  onEdit,
  onRemove,
  onDefault,
  onCheck,
}: {
  c: ContactPoint;
  disabled: boolean;
  checking: boolean;
  checkNote: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onDefault: (v: boolean) => void;
  onCheck: () => void;
}) {
  const isLink = LINK_KINDS.has(c.kind);
  const shown = c.display ?? c.value;
  return (
    <li className="space-y-1 rounded-xl border border-stone-200 p-3" data-contact-id={c.id} data-contact-kind={c.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-stone-600">{t.kinds[c.kind]}</p>
          <p className="break-words font-medium">{shown}</p>
          {(c.kind === "phone" || c.kind === "whatsapp") && c.value !== shown && <p className="text-sm text-stone-500">{c.value}</p>}
          {c.kind === "address" && typeof c.details.full === "string" && c.details.full !== shown && <p className="text-sm text-stone-500">{c.details.full}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">{t.source[c.source]}</span>
          {isLink && (
            <span
              data-verified={c.verifiedAt ? "yes" : "no"}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${c.verifiedAt ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "bg-stone-100 text-stone-700"}`}
            >
              {c.verifiedAt ? t.verified : t.notChecked}
            </span>
          )}
        </div>
      </div>
      {checkNote && (
        <p role="status" className="text-sm text-amber-900">
          {checkNote}
        </p>
      )}
      <label className="flex min-h-10 items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={c.isDefault} disabled={disabled} onChange={(e) => onDefault(e.target.checked)} />
        <span>{t.showOnPosts}</span>
      </label>
      <div className="flex flex-wrap gap-4">
        <button type="button" className="min-h-10 text-sm underline" disabled={disabled} onClick={onEdit}>
          {t.edit}
        </button>
        {isLink && (
          <button type="button" className="min-h-10 text-sm underline" disabled={disabled || checking} onClick={onCheck}>
            {checking ? t.checking : t.checkLink}
          </button>
        )}
        <button type="button" className="min-h-10 text-sm text-red-700 underline" disabled={disabled} onClick={onRemove}>
          {t.remove}
        </button>
      </div>
    </li>
  );
}

/** How customers reach the business: every contact kind, "show on new posts" per item, hours editor, link check. */
export function ContactsSection({ brandId, contacts, country }: { brandId: string; contacts: ContactPoint[]; country: string | null }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ContactPoint | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function open(c: ContactPoint | null) {
    setError(null);
    setErrors({});
    setEditing(c);
    setAdding(c === null);
    if (!c) return setDraft(emptyDraft());
    const full = typeof c.details.full === "string" ? c.details.full : "";
    setDraft({
      kind: c.kind,
      value: c.kind === "address" ? (c.display ?? c.value) : c.value,
      label: c.kind === "custom_link" || c.kind === "booking" ? (c.display ?? "") : "",
      full: c.kind === "address" && full !== (c.display ?? c.value) ? full : "",
      isDefault: c.isDefault,
      days: c.kind === "hours" ? daysFromDetails(c.details) : emptyDays(),
    });
  }
  function close() {
    setAdding(false);
    setEditing(null);
    setErrors({});
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const input = inputOf(draft);
      const r = editing ? await updateContactAction(brandId, editing.id, input) : await createContactAction(brandId, input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.message);
        return;
      }
      setErrors({});
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

  function check(c: ContactPoint) {
    setCheckingId(c.id);
    setNotes((n) => ({ ...n, [c.id]: "" }));
    startTransition(async () => {
      try {
        const r = await checkContactLinkAction(brandId, c.id);
        if (!r.ok) setError(r.message);
        else if (!r.reachable) setNotes((n) => ({ ...n, [c.id]: t.notReachable }));
      } catch {
        setError(t.errors.generic);
      } finally {
        setCheckingId(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>
      {contacts.length === 0 && !adding && <p className="text-[14px] leading-5 text-desc">{t.empty}</p>}
      <ul className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-2 lg:space-y-0">
        {contacts.map((c) =>
          editing?.id === c.id ? (
            <li key={c.id} className="lg:col-span-2">
              <ContactForm
                draft={draft}
                setDraft={setDraft}
                errors={errors}
                pending={pending}
                editing
                country={country}
                onSave={save}
                onCancel={close}
                idPrefix={`edit-contact-${c.id}`}
                importedHours={c.kind === "hours" && !c.details.days}
              />
            </li>
          ) : (
            <ContactItem
              key={c.id}
              c={c}
              disabled={pending}
              checking={checkingId === c.id}
              checkNote={notes[c.id] || null}
              onEdit={() => open(c)}
              onRemove={() => act(() => removeContactAction(brandId, c.id))}
              onDefault={(v) => act(() => setContactDefaultAction(brandId, c.id, v))}
              onCheck={() => check(c)}
            />
          ),
        )}
      </ul>
      {adding ? (
        <ContactForm draft={draft} setDraft={setDraft} errors={errors} pending={pending} editing={false} country={country} onSave={save} onCancel={close} idPrefix="add-contact" importedHours={false} />
      ) : (
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => open(null)}>
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
