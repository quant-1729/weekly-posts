"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { chooseLogoVariantAction, saveKitAction } from "@/app/(app)/brand/kit-actions";
import { PalettePicker } from "@/components/brand-pickers";
import { chipClass, errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import type { Palette } from "@/lib/brand/colors";
import { FONT_CHOICES, THEME_IDS, type BrandKit, type FontChoice, type ThemeId } from "@/lib/design/types";
import { fill } from "@/lib/i18n/strings";
import { contrastWarnings } from "@/lib/kit/contrast";
import { kitCopy } from "@/lib/kit/copy";
import { deriveBackground, kitFromColors } from "@/lib/kit/defaults";
import { fontFaceCss, type FontFace } from "@/lib/kit/font-css";
import type { LogoInfo, LogoReport } from "@/lib/logo/store";

const t = kitCopy;
const COLOR_KEYS = ["primary", "secondary", "accent", "background"] as const;

// ---------------------------------------------------------------------------
// Logo extras: size warning, white-background choice
// ---------------------------------------------------------------------------

const checker = {
  backgroundImage: "linear-gradient(45deg,#e7e5e4 25%,transparent 25%),linear-gradient(-45deg,#e7e5e4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e7e5e4 75%),linear-gradient(-45deg,transparent 75%,#e7e5e4 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
} as const;

/** Under the logo uploader: low-resolution warning, what happened to a white background, and the choice between the two versions. */
export function LogoExtras({ brandId, logo, report, onChosen }: { brandId: string; logo: LogoInfo; report: LogoReport | null; onChosen: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);

  const low = report ? report.lowResolution : logo.lowResolution;
  const size = report && report.width ? report : logo;
  const choose = (variant: "with_background" | "without_background") => {
    setError(null);
    startTransition(async () => {
      const r = await chooseLogoVariantAction(brandId, variant);
      if (!r.ok) return setError(r.message);
      setStamp(Date.now());
      onChosen();
      router.refresh();
    });
  };
  const view = (file: string) => `/api/files/${file}${stamp ? `?v=${stamp}` : ""}`;

  if (!logo.logoPath) return null;
  return (
    <div className="space-y-3" data-logo-extras>
      {low && (
        <p role="status" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-logo-warning="low-resolution">
          {fill(t.logo.lowResolution, { w: size.width, h: size.height })}
        </p>
      )}
      {report && (
        <p role="status" className="text-sm text-stone-700" data-logo-background={report.background}>
          {report.message}
        </p>
      )}
      {logo.hasChoice && logo.originalFile && logo.cleanFile && (
        <fieldset className="space-y-2" data-logo-choice>
          <legend className="font-medium">{t.logo.choiceTitle}</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["with_background", logo.originalFile, t.logo.original, t.logo.useWith],
                ["without_background", logo.cleanFile, t.logo.clean, t.logo.useWithout],
              ] as const
            ).map(([variant, file, label, action]) => (
              <div key={variant} className="space-y-1 text-center">
                <div className="flex h-24 items-center justify-center rounded-lg border border-stone-200" style={checker}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={view(file)} alt={label} className="max-h-full max-w-full object-contain" />
                </div>
                <button type="button" aria-pressed={logo.active === variant} disabled={pending || logo.active === variant} onClick={() => choose(variant)} className={chipClass(logo.active === variant)}>
                  {action}
                </button>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colours, fonts, style, theme, text logo
// ---------------------------------------------------------------------------

type Draft = Pick<BrandKit, "colors" | "fonts" | "style" | "themeId" | "textLogo">;
const draftOf = (k: BrandKit): Draft => ({ colors: k.colors, fonts: k.fonts, style: k.style, themeId: k.themeId, textLogo: k.textLogo });

function Toggle<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`${chipClass(value === v)} flex-1`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function fontStyle(faces: FontFace[], role: FontChoice, bold: boolean): React.CSSProperties {
  const face = faces.find((f) => f.role === role);
  return face
    ? { fontFamily: `"${face.family}", system-ui, sans-serif`, fontWeight: bold ? 700 : 400, fontSynthesis: "none" }
    : { fontWeight: bold ? 700 : 400 };
}

function FontPicker({ label, value, onChange, faces, businessName }: { label: string; value: FontChoice; onChange: (f: FontChoice) => void; faces: FontFace[]; businessName: string }) {
  return (
    <div role="group" aria-label={label} className="space-y-2" data-font-picker={label}>
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {FONT_CHOICES.map((role) => (
          <button key={role} type="button" aria-pressed={value === role} onClick={() => onChange(role)} className={chipClass(value === role)} style={fontStyle(faces, role, false)}>
            {t.fonts.roles[role]}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-3" data-font-sample={value}>
        <p className="text-xl" style={fontStyle(faces, value, true)}>
          {businessName}
        </p>
        <p className="text-sm text-stone-600" style={fontStyle(faces, value, false)}>
          {t.fonts.sample}
        </p>
      </div>
    </div>
  );
}

export function KitEditor({
  brandId,
  kit,
  logoPalette,
  hasLogo,
  businessName,
  fontFaces,
  textLogoSvg,
  themePreviews,
}: {
  brandId: string;
  kit: BrandKit;
  logoPalette: Palette | null;
  hasLogo: boolean;
  businessName: string;
  fontFaces: FontFace[];
  /** The business name drawn as a text logo from the saved kit (built on the server). */
  textLogoSvg: string | null;
  /** Preview image URL per theme (from the design engine). A theme without one shows a placeholder. */
  themePreviews?: Partial<Record<ThemeId, string>>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(draftOf(kit));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // What the server holds changed (a save, an accepted offer, "keep my look"): take it in.
  const key = JSON.stringify(draftOf(kit));
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setDraft(draftOf(kit));
  }

  const dirty = JSON.stringify(draft) !== key;
  const set = (patch: Partial<Draft>) => {
    setMessage(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setColor = (name: (typeof COLOR_KEYS)[number], value: string) => set({ colors: { ...draft.colors, [name]: value.toUpperCase() } });
  const warnings = contrastWarnings(draft.colors);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const r = await saveKitAction(brandId, draft);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: t.saved });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" data-kit-editor>
      {/* The shipped font files, for the samples below. */}
      {fontFaces.length > 0 && <style>{fontFaceCss(fontFaces)}</style>}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t.colors.title}</h3>
        <p className={hintClass}>{t.colors.hint}</p>
        <PalettePicker
          value={draft.colors}
          logoPalette={logoPalette}
          onChange={(p) => set({ colors: { ...p, background: deriveBackground(p, draft.style.mode) } })}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {COLOR_KEYS.map((name) => (
            <label key={name} className="flex flex-col gap-1 text-sm" data-color={name}>
              <span className="font-medium">{t.colors.labels[name]}</span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={fill(t.colors.pickerLabel, { name: t.colors.labels[name] })}
                  value={draft.colors[name].toLowerCase()}
                  onChange={(e) => setColor(name, e.target.value)}
                  className="h-12 w-14 shrink-0 cursor-pointer rounded-md border border-stone-300 bg-white p-1"
                />
                <span className="h-8 flex-1 rounded-md border border-stone-200" style={{ background: draft.colors[name] }} aria-hidden="true" />
              </span>
              <span className="text-xs text-stone-500">{draft.colors[name]}</span>
            </label>
          ))}
        </div>
        {warnings.map((w) => (
          <div key={w.pair} role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-contrast-warning>
            <p>{fill(t.colors.contrastWarning, { ratio: w.ratio, min: w.min })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} onClick={() => setColor("primary", w.suggestion.primary)}>
                {fill(t.colors.useDarker, { color: w.suggestion.primary })}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setColor("background", w.suggestion.background)}>
                {fill(t.colors.useBackground, { tone: w.suggestion.background === "#FFFFFF" ? t.colors.toneLight : t.colors.toneDark })}
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="text-sm text-stone-700 underline" onClick={() => {
            const { primary, secondary, accent } = draft.colors;
            set({ ...draftOf(kitFromColors({ primary, secondary, accent })), textLogo: draft.textLogo });
          }}>
          {t.colors.suggest}
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">{t.fonts.title}</h3>
        <p className={hintClass}>{t.fonts.hint}</p>
        <FontPicker label={t.fonts.headline} value={draft.fonts.headline} faces={fontFaces} businessName={businessName} onChange={(headline) => set({ fonts: { ...draft.fonts, headline } })} />
        <FontPicker label={t.fonts.body} value={draft.fonts.body} faces={fontFaces} businessName={businessName} onChange={(body) => set({ fonts: { ...draft.fonts, body } })} />
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">{t.style.title}</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Toggle
            label={t.style.corners.label}
            value={draft.style.corners}
            options={[["rounded", t.style.corners.rounded], ["sharp", t.style.corners.sharp]]}
            onChange={(corners) => set({ style: { ...draft.style, corners } })}
          />
          <Toggle
            label={t.style.mode.label}
            value={draft.style.mode}
            options={[["light", t.style.mode.light], ["dark", t.style.mode.dark]]}
            onChange={(mode) => set({ style: { ...draft.style, mode }, colors: { ...draft.colors, background: deriveBackground(draft.colors, mode) } })}
          />
          <Toggle
            label={t.style.energy.label}
            value={draft.style.energy}
            options={[["calm", t.style.energy.calm], ["bold", t.style.energy.bold]]}
            onChange={(energy) => set({ style: { ...draft.style, energy } })}
          />
        </div>
      </div>

      <div className="space-y-2" id="look-themes" data-themes>
        <h3 className="text-lg font-semibold">{t.themes.title}</h3>
        <p className={hintClass}>{t.themes.hint}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={t.themes.title}>
          {THEME_IDS.map((id) => {
            const preview = themePreviews?.[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={draft.themeId === id}
                data-theme={id}
                onClick={() => set({ themeId: id })}
                className={`flex flex-col gap-2 rounded-lg border p-2 text-left ${draft.themeId === id ? "border-[#E4572E] ring-2 ring-[#E4572E]/40" : "border-stone-300"}`}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={fill(t.themes.previewAlt, { name: t.themes.names[id] })} className="aspect-square w-full rounded-md border border-stone-200 object-cover" data-theme-preview />
                ) : (
                  <span className="aspect-[2/1] w-full rounded-md border border-dashed border-stone-300 bg-stone-50" aria-hidden="true" data-theme-preview-slot />
                )}
                <span className="font-semibold">{t.themes.names[id]}</span>
                <span className="text-sm font-normal text-stone-600">{t.themes.descriptions[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.textLogo} onChange={(e) => set({ textLogo: e.target.checked })} />
          <span>{t.textLogo.label}</span>
        </label>
        {!hasLogo && draft.textLogo && textLogoSvg && (
          <div className="rounded-lg border border-stone-200 p-3" data-text-logo-preview>
            <p className="mb-1 text-sm text-stone-600">{t.textLogo.previewTitle}</p>
            <div
              role="img"
              aria-label={t.textLogo.previewAlt}
              className="w-48 rounded-md bg-white [&>svg]:h-auto [&>svg]:w-full"
              // The SVG is drawn on the server from glyph outlines and numbers only; the business name is never put in it as text.
              dangerouslySetInnerHTML={{ __html: textLogoSvg }}
            />
          </div>
        )}
        <p className="text-sm text-stone-600">
          {t.mascot.text}{" "}
          <Link href="/mascot" className="font-medium underline">
            {t.mascot.link}
          </Link>
          .
        </p>
      </div>

      <div className="space-y-2">
        <button type="button" className={primaryButton} disabled={pending || !dirty} onClick={save}>
          {pending ? t.saving : t.save}
        </button>
        <div role="status" aria-live="polite">
          {message && <p className={message.ok ? "text-sm text-emerald-800" : errorClass}>{message.text}</p>}
        </div>
      </div>
    </div>
  );
}
