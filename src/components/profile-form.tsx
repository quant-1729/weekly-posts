"use client";

import { useMemo, useState } from "react";
import { LanguagePicker, LogoUploader, PalettePicker, TonePicker } from "@/components/brand-pickers";
import type { Palette } from "@/lib/brand/colors";
import { matchUnclear } from "@/lib/brand/extract";
import {
  MAX_PRODUCTS,
  PRODUCT_LIMITS,
  parseProfile,
  type FieldErrors,
  type ProfileDraft,
} from "@/lib/brand/schema";
import { s } from "@/lib/i18n/strings";
import {
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  unsureClass,
} from "./ui";

/**
 * The editable brand profile: every R2 field. Used by the setup review screen
 * and by /brand. Validates with the same zod schema as the server before
 * sending, and shows the server's field errors if it still disagrees.
 */

export type SaveResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

const errorText = s.brand.errors as Record<string, string>;

export function ProfileForm({
  brandId,
  initial,
  initialLogoPath,
  unclear = [],
  submitLabel,
  onSave,
  onSaved,
}: {
  brandId: string;
  initial: ProfileDraft;
  initialLogoPath: string | null;
  /** The AI's "please check" notes from setup. Matching fields are highlighted. */
  unclear?: string[];
  submitLabel: string;
  onSave: (values: ProfileDraft) => Promise<SaveResult>;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [logoPath, setLogoPath] = useState<string | null>(initialLogoPath);
  const [logoPalette, setLogoPalette] = useState<Palette | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const unsure = useMemo(() => matchUnclear(unclear, draft), [unclear, draft]);
  const isUnsure = (field: string) => (unsure.fields as string[]).includes(field);

  function set<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setMessage(null);
  }

  function setProduct(i: number, key: keyof ProfileDraft["products"][number], value: string) {
    setDraft((d) => ({
      ...d,
      products: d.products.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)),
    }));
    setMessage(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const parsed = parseProfile(draft);
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      setMessage({ kind: "error", text: s.brand.saveFailed });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await onSave(draft);
      if (res.ok) {
        setMessage({ kind: "ok", text: s.brand.saved });
        onSaved?.();
      } else {
        setErrors(res.fieldErrors ?? {});
        setMessage({ kind: "error", text: res.message });
      }
    } catch {
      setMessage({ kind: "error", text: s.errors.generic });
    } finally {
      setSaving(false);
    }
  }

  const err = (path: string) =>
    errors[path] ? (
      <p role="alert" className={errorClass}>
        {errorText[errors[path]] ?? errorText.invalid}
      </p>
    ) : null;

  const wrap = (field: string) => (isUnsure(field) ? unsureClass : "");

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {unclear.length > 0 && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">{s.setup.unclearTitle}</p>
          <p className="text-sm">{s.setup.unclearHint}</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {unclear.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-card-title text-title">{s.brand.sections.basics}</legend>

        <div className={wrap("business_name")}>
          <label htmlFor="business_name" className={labelClass}>
            {s.brand.businessName}
          </label>
          <input
            id="business_name"
            className={inputClass}
            value={draft.business_name}
            onChange={(e) => set("business_name", e.target.value)}
            maxLength={100}
            autoComplete="organization"
          />
          {err("business_name")}
        </div>

        <div className={wrap("category")}>
          <label htmlFor="category" className={labelClass}>
            {s.brand.category}
          </label>
          <input
            id="category"
            className={inputClass}
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            maxLength={100}
            placeholder={s.brand.categoryHint}
          />
          {err("category")}
        </div>

        <div className={wrap("city")}>
          <label htmlFor="city" className={labelClass}>
            {s.brand.city}
          </label>
          <input
            id="city"
            className={inputClass}
            value={draft.city}
            onChange={(e) => set("city", e.target.value)}
            maxLength={100}
          />
          {err("city")}
        </div>

        <div className={wrap("audience")}>
          <label htmlFor="audience" className={labelClass}>
            {s.brand.audience}
          </label>
          <textarea
            id="audience"
            className={inputClass}
            rows={2}
            value={draft.audience}
            onChange={(e) => set("audience", e.target.value)}
            maxLength={300}
            placeholder={s.brand.audienceHint}
          />
          {err("audience")}
        </div>
      </fieldset>

      <fieldset className={`space-y-3 ${wrap("products")}`}>
        <legend className="mb-1 text-card-title text-title">{s.brand.sections.products}</legend>
        <p className={hintClass}>{s.brand.productsHint}</p>
        {draft.products.length === 0 && <p className="text-sm text-stone-500">{s.brand.noProducts}</p>}
        {draft.products.map((p, i) => (
          <div
            key={i}
            className={`space-y-2 rounded-lg border p-3 ${
              unsure.productRows.includes(i) ? "border-amber-400 bg-amber-50 ring-2 ring-amber-400" : "border-stone-200"
            }`}
          >
            <div>
              <label htmlFor={`p-name-${i}`} className="mb-1 block text-sm font-medium">
                {s.brand.productName}
              </label>
              <input
                id={`p-name-${i}`}
                className={inputClass}
                value={p.name}
                maxLength={PRODUCT_LIMITS.name}
                onChange={(e) => setProduct(i, "name", e.target.value)}
              />
              {err(`products.${i}.name`)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`p-price-${i}`} className="mb-1 block text-sm font-medium">
                  {s.brand.productPrice}
                </label>
                <input
                  id={`p-price-${i}`}
                  className={inputClass}
                  inputMode="decimal"
                  value={p.price}
                  maxLength={PRODUCT_LIMITS.price}
                  onChange={(e) => setProduct(i, "price", e.target.value)}
                />
                {err(`products.${i}.price`)}
              </div>
              <div>
                <label htmlFor={`p-unit-${i}`} className="mb-1 block text-sm font-medium">
                  {s.brand.productUnit}
                </label>
                <input
                  id={`p-unit-${i}`}
                  className={inputClass}
                  value={p.unit}
                  maxLength={PRODUCT_LIMITS.unit}
                  onChange={(e) => setProduct(i, "unit", e.target.value)}
                />
                {err(`products.${i}.unit`)}
              </div>
            </div>
            <div>
              <label htmlFor={`p-note-${i}`} className="mb-1 block text-sm font-medium">
                {s.brand.productNote}
              </label>
              <input
                id={`p-note-${i}`}
                className={inputClass}
                value={p.note}
                maxLength={PRODUCT_LIMITS.note}
                onChange={(e) => setProduct(i, "note", e.target.value)}
              />
              {err(`products.${i}.note`)}
            </div>
            <button
              type="button"
              className="text-sm text-red-700 underline"
              onClick={() => set("products", draft.products.filter((_, idx) => idx !== i))}
            >
              {s.brand.removeProduct}
            </button>
          </div>
        ))}
        {err("products")}
        <button
          type="button"
          className={secondaryButton}
          disabled={draft.products.length >= MAX_PRODUCTS}
          onClick={() => set("products", [...draft.products, { name: "", price: "", unit: "", note: "" }])}
        >
          {s.brand.addProduct}
        </button>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-2 text-card-title text-title">{s.brand.sections.look}</legend>

        <div>
          <p className={labelClass}>{s.brand.tone}</p>
          <TonePicker value={draft.tone} onChange={(t) => set("tone", t)} />
          {err("tone")}
        </div>

        <div>
          <p className={labelClass}>{s.brand.languages}</p>
          <LanguagePicker
            languages={draft.languages}
            defaultLanguage={draft.default_language}
            onChange={(languages, def) => {
              setDraft((d) => ({ ...d, languages, default_language: def }));
              setMessage(null);
            }}
          />
          {err("languages")}
          {err("default_language")}
        </div>

        <div>
          <p className={labelClass}>{s.brand.logo}</p>
          <LogoUploader
            brandId={brandId}
            logoPath={logoPath}
            onChange={(path, palette) => {
              setLogoPath(path);
              setLogoPalette(palette);
            }}
          />
          <p className="mt-1 text-xs text-stone-500">{s.brand.logoNote}</p>
        </div>

        <div>
          <p className={labelClass}>{s.brand.colors}</p>
          <PalettePicker value={draft.colors} onChange={(p) => set("colors", p)} logoPalette={logoPalette} />
          {err("colors.primary") ?? err("colors.secondary") ?? err("colors.accent")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-card-title text-title">{s.brand.sections.contact}</legend>

        <div>
          <label htmlFor="whatsapp" className={labelClass}>
            {s.brand.whatsapp}
          </label>
          <p className={hintClass}>{s.brand.whatsappHint}</p>
          <input
            id="whatsapp"
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.whatsapp_number}
            onChange={(e) => set("whatsapp_number", e.target.value)}
            maxLength={20}
          />
          {err("whatsapp_number")}
        </div>

        <div className={wrap("notes")}>
          <label htmlFor="notes" className={labelClass}>
            {s.brand.notes}
          </label>
          <p className={hintClass}>{s.brand.notesHint}</p>
          <textarea
            id="notes"
            className={inputClass}
            rows={4}
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            maxLength={1500}
          />
          {err("notes")}
        </div>
      </fieldset>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "text-red-700" : "font-medium text-green-800"}
        >
          {message.text}
        </p>
      )}

      <button type="submit" disabled={saving} className={primaryButton}>
        {saving ? s.brand.saving : submitLabel}
      </button>
    </form>
  );
}
