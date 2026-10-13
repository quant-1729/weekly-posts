"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveColorsAction, applyWebsiteLogoAction } from "@/app/(app)/brand/actions";
import { LogoUploader, PalettePicker } from "@/components/brand-pickers";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import type { Palette } from "@/lib/brand/colors";
import { isHexColor, samePalette } from "@/lib/brand/colors";
import { s } from "@/lib/i18n/strings";

const t = s.brandV2.look;

function Swatch({ palette }: { palette: Palette }) {
  return (
    <span className="flex h-8 w-full overflow-hidden rounded-md border border-stone-200" aria-hidden="true">
      <span className="flex-[3]" style={{ background: palette.primary }} />
      <span className="flex-[2]" style={{ background: palette.secondary }} />
      <span className="flex-[1]" style={{ background: palette.accent }} />
    </span>
  );
}

function asPalette(c: Partial<Palette>): Palette | null {
  return isHexColor(c.primary) && isHexColor(c.secondary) && isHexColor(c.accent) ? { primary: c.primary, secondary: c.secondary, accent: c.accent } : null;
}

/** Logo (upload, replace, remove: the v1 uploader) and brand colours (the v1 palette picker). */
export function LookPanel({
  brandId,
  logoPath,
  colors,
  logoPalette,
}: {
  brandId: string;
  logoPath: string | null;
  colors: Partial<Palette>;
  /** A palette taken from the saved logo. */
  logoPalette: Palette | null;
}) {
  const router = useRouter();
  const [path, setPath] = useState(logoPath);
  const [palette, setPalette] = useState<Partial<Palette>>(colors);
  const [fromLogo, setFromLogo] = useState<Palette | null>(logoPalette);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // What the server holds changed (an offer was accepted, or a refresh): take it in.
  const [seen, setSeen] = useState({ logoPath, colors, logoPalette });
  if (seen.logoPath !== logoPath || seen.colors !== colors || seen.logoPalette !== logoPalette) {
    setSeen({ logoPath, colors, logoPalette });
    setPath(logoPath);
    setPalette(colors);
    setFromLogo(logoPalette);
  }

  function saveColors() {
    const full = asPalette(palette);
    if (!full) return;
    setMessage(null);
    startTransition(async () => {
      const r = await saveColorsAction(brandId, full);
      setMessage(r.ok ? { ok: true, text: t.colorsSaved } : { ok: false, text: r.message });
    });
  }

  const full = asPalette(palette);
  const saved = asPalette(colors);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t.logoTitle}</h3>
        <LogoUploader
          brandId={brandId}
          logoPath={path}
          onChange={(next, suggested) => {
            setPath(next);
            setFromLogo(suggested);
            router.refresh();
          }}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t.colorsTitle}</h3>
        <p className={hintClass}>{t.colorsHint}</p>
        <PalettePicker value={palette} onChange={(p) => setPalette(p)} logoPalette={fromLogo} />
        <button type="button" className={secondaryButton} disabled={pending || !full || (saved !== null && samePalette(full, saved))} onClick={saveColors}>
          {t.colorsSave}
        </button>
        <div role="status" aria-live="polite">
          {message && <p className={message.ok ? "text-sm text-emerald-800" : errorClass}>{message.text}</p>}
        </div>
      </div>
    </div>
  );
}

/** "Use the logo from your website?" Shown when the website was read and there is no logo yet. */
export function WebsiteLogoOffer({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;

  function use() {
    setMessage(null);
    startTransition(async () => {
      const r = await applyWebsiteLogoAction(brandId);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: t.offerDone });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-[#E4572E]/40 bg-[#E4572E]/5 p-3" data-offer="website-logo">
      <p className="font-semibold">{t.offerTitle}</p>
      <p className="text-sm text-stone-700">{t.offerBody}</p>
      <div className="flex gap-2">
        <button type="button" className={primaryButton} disabled={pending} onClick={use}>
          {pending ? t.offerWorking : t.offerUse}
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => setHidden(true)}>
          {t.offerNo}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {message && <p className={message.ok ? "text-sm text-emerald-800" : errorClass}>{message.text}</p>}
      </div>
    </div>
  );
}

/** The website's theme colour as a ready palette the owner can take. */
export function ThemeColorOffer({ brandId, palette }: { brandId: string; palette: Palette }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function use() {
    setMessage(null);
    startTransition(async () => {
      const r = await saveColorsAction(brandId, palette);
      if (!r.ok) return setMessage({ ok: false, text: r.message });
      setMessage({ ok: true, text: t.colorsSaved });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-stone-200 p-3" data-offer="theme-color">
      <p className="font-medium">{t.colorsFromWebsite}</p>
      <Swatch palette={palette} />
      <button type="button" className={secondaryButton} disabled={pending} onClick={use}>
        {t.offerUse}
      </button>
      <div role="status" aria-live="polite">
        {message && <p className={message.ok ? "text-sm text-emerald-800" : errorClass}>{message.text}</p>}
      </div>
    </div>
  );
}
