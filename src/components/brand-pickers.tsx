"use client";

import { useRef, useState } from "react";
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/ai/schemas";
import { PRESET_PALETTES, paletteFromPrimary, samePalette, type Palette } from "@/lib/brand/colors";
import { LOGO_ACCEPT, logoUrl } from "@/lib/brand/logo-url";
import { TONE_OPTIONS } from "@/lib/brand/schema";
import type { LogoReport } from "@/lib/logo/store";
import { s } from "@/lib/i18n/strings";
import { chipClass, errorClass, secondaryButton } from "./ui";

/** Tap pickers shared by the setup steps and the profile form. */

// ---------------------------------------------------------------------------
// Languages (multi-select) and the default
// ---------------------------------------------------------------------------

export function LanguagePicker({
  languages,
  defaultLanguage,
  onChange,
}: {
  languages: ContentLanguage[];
  defaultLanguage: ContentLanguage | "";
  onChange: (languages: ContentLanguage[], defaultLanguage: ContentLanguage | "") => void;
}) {
  function toggle(lang: ContentLanguage) {
    const next = languages.includes(lang)
      ? languages.filter((l) => l !== lang)
      : CONTENT_LANGUAGES.filter((l) => l === lang || languages.includes(l));
    let def = defaultLanguage;
    if (!def || !next.includes(def)) def = next[0] ?? "";
    onChange(next, def);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2" role="group" aria-label={s.brand.languages}>
        {CONTENT_LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            aria-pressed={languages.includes(lang)}
            onClick={() => toggle(lang)}
            className={`${chipClass(languages.includes(lang))} text-left`}
          >
            <span className="block text-lg">{s.brand.languageNames[lang]}</span>
            <span className="block text-sm font-normal text-stone-600">{s.brand.languageHints[lang]}</span>
          </button>
        ))}
      </div>

      {languages.length > 1 && (
        <fieldset>
          <legend className="mb-1 font-medium">{s.setup.defaultLanguageTitle}</legend>
          <div className="flex flex-wrap gap-2">
            {languages.map((lang) => (
              <button
                key={lang}
                type="button"
                aria-pressed={defaultLanguage === lang}
                onClick={() => onChange(languages, lang)}
                className={chipClass(defaultLanguage === lang)}
              >
                {s.brand.languageNames[lang]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tone (one of four)
// ---------------------------------------------------------------------------

export function TonePicker({ value, onChange }: { value: string; onChange: (tone: string) => void }) {
  // A tone saved earlier that is not one of the four stays selectable.
  const options: string[] = [...TONE_OPTIONS];
  if (value && !options.includes(value)) options.push(value);
  return (
    <div className="grid grid-cols-1 gap-2" role="group" aria-label={s.brand.tone}>
      {options.map((tone) => (
        <button
          key={tone}
          type="button"
          aria-pressed={value === tone}
          onClick={() => onChange(tone)}
          className={`${chipClass(value === tone)} text-left text-lg`}
        >
          {tone}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colours: presets, a palette from the logo, or one custom colour
// ---------------------------------------------------------------------------

function Swatch({ palette }: { palette: Palette }) {
  return (
    <span className="flex h-8 w-full overflow-hidden rounded-md border border-stone-200" aria-hidden="true">
      <span className="flex-[3]" style={{ background: palette.primary }} />
      <span className="flex-[2]" style={{ background: palette.secondary }} />
      <span className="flex-[1]" style={{ background: palette.accent }} />
    </span>
  );
}

export function PalettePicker({
  value,
  onChange,
  logoPalette,
}: {
  value: Partial<Palette>;
  onChange: (palette: Palette) => void;
  logoPalette?: Palette | null;
}) {
  const options: { key: string; label: string; palette: Palette }[] = [];
  if (logoPalette) options.push({ key: "logo", label: s.brand.colorsFromLogo, palette: logoPalette });
  for (const p of PRESET_PALETTES) {
    options.push({ key: p.id, label: s.brand.palettes[p.id as keyof typeof s.brand.palettes], palette: p });
  }
  const matchesOption = options.some((o) => samePalette(value, o.palette));
  const hasValue = Boolean(value.primary);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={s.brand.colors}>
        {options.map((o) => {
          const selected = samePalette(value, o.palette);
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(o.palette)}
              className={`flex flex-col gap-1 rounded-lg border p-2 text-left text-sm ${
                selected ? "border-[#E4572E] ring-2 ring-[#E4572E]/40" : "border-stone-300"
              }`}
            >
              <Swatch palette={o.palette} />
              {o.label}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-3">
        <input
          type="color"
          aria-label={s.brand.colorsCustom}
          value={value.primary && /^#[0-9a-fA-F]{6}$/.test(value.primary) ? value.primary : "#E4572E"}
          onChange={(e) => onChange(paletteFromPrimary(e.target.value))}
          className="h-12 w-16 shrink-0 cursor-pointer rounded-md border border-stone-300 bg-white p-1"
        />
        <span className="text-sm">{s.brand.colorsCustom}</span>
      </label>

      {hasValue && !matchesOption && value.secondary && value.accent && (
        <div className="space-y-1">
          <Swatch palette={value as Palette} />
          <p className="text-xs text-stone-500">
            {s.brand.colorPrimary} {value.primary} · {s.brand.colorSecondary} {value.secondary} · {s.brand.colorAccent}{" "}
            {value.accent}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo upload (saved on the server as soon as it is chosen)
// ---------------------------------------------------------------------------

export function LogoUploader({
  brandId,
  logoPath,
  onChange,
  onUploaded,
  version: initialVersion,
}: {
  brandId: string;
  logoPath: string | null;
  /** New logo path (or null after removing), plus a palette suggested from the logo. */
  onChange: (logoPath: string | null, palette: Palette | null) => void;
  /** After an upload: the size check and white-background result (null if the check could not run). */
  onUploaded?: (report: LogoReport | null) => void;
  /** Cache-buster for the picture shown (changes when the stored file is swapped without an upload). */
  version?: string | number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState<string | number>(initialVersion ?? 0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const form = new FormData();
      form.set("brand_id", brandId);
      form.set("file", file);
      const res = await fetch("/api/brand/logo", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; logoPath: string; palette: Palette | null; report?: LogoReport | null }
        | { ok: false; message?: string }
        | null;
      if (!data) setError(s.errors.signedOut);
      else if (!data.ok) setError(data.message ?? s.errors.generic);
      else {
        setVersion(Date.now());
        setSaved(true);
        onUploaded?.(data.report ?? null);
        onChange(data.logoPath, data.palette);
      }
    } catch {
      setError(s.errors.generic);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/brand/logo?brand_id=${encodeURIComponent(brandId)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { ok: boolean; message?: string } | null;
      if (data?.ok) onChange(null, null);
      else setError(data?.message ?? s.errors.generic);
    } catch {
      setError(s.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const src = logoUrl(logoPath, version || undefined);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={s.brand.logo} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-stone-500">{s.brand.logoNone}</span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={secondaryButton}>
            {busy ? s.brand.logoUploading : logoPath ? s.brand.logoReplace : s.brand.logoUpload}
          </button>
          {logoPath && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="text-sm text-stone-600 underline">
              {s.brand.logoRemove}
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        aria-label={s.brand.logoUpload}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      {saved && (
        <p role="status" className="text-sm text-green-800">
          {s.brand.logoSaved}
        </p>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
