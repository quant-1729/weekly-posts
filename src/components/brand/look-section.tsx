"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveColorsAction, applyWebsiteLogoAction } from "@/app/(app)/brand/actions";
import { LogoUploader } from "@/components/brand-pickers";
import { errorClass, primaryButton, secondaryButton } from "@/components/ui";
import type { Palette } from "@/lib/brand/colors";
import type { BrandKit, ThemeId } from "@/lib/design/types";
import type { FontFace } from "@/lib/kit/font-css";
import type { LogoInfo, LogoReport } from "@/lib/logo/store";
import { s } from "@/lib/i18n/strings";
import { KitEditor, LogoExtras } from "./look-kit";

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

/**
 * The Look section: logo (the v1 uploader, plus the size warning and the white-background choice), then the
 * brand kit editor (colours, fonts, style, default theme, text logo).
 * `children` is shown between the logo and the kit editor: the "Keep my look" card mounts there.
 */
export function LookPanel({
  brandId,
  logoPath,
  logoPalette,
  kit,
  logo,
  businessName,
  fontFaces,
  textLogoSvg,
  themePreviews,
  children,
}: {
  brandId: string;
  logoPath: string | null;
  /** A palette taken from the saved logo. */
  logoPalette: Palette | null;
  kit: BrandKit;
  logo: LogoInfo;
  businessName: string;
  fontFaces: FontFace[];
  textLogoSvg: string | null;
  themePreviews?: Partial<Record<ThemeId, string>>;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [path, setPath] = useState(logoPath);
  const [fromLogo, setFromLogo] = useState<Palette | null>(logoPalette);
  const [report, setReport] = useState<LogoReport | null>(null);
  const [version, setVersion] = useState(0);

  // What the server holds changed (an offer was accepted, or a refresh): take it in.
  const [seen, setSeen] = useState({ logoPath, logoPalette });
  if (seen.logoPath !== logoPath || seen.logoPalette !== logoPalette) {
    setSeen({ logoPath, logoPalette });
    setPath(logoPath);
    setFromLogo(logoPalette);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-card-title text-title">{t.logoTitle}</h3>
        <LogoUploader
          key={version}
          version={version || undefined}
          brandId={brandId}
          logoPath={path}
          onUploaded={setReport}
          onChange={(next, suggested) => {
            setPath(next);
            setFromLogo(suggested);
            if (!next) setReport(null);
            router.refresh();
          }}
        />
        <LogoExtras brandId={brandId} logo={{ ...logo, logoPath: path }} report={report} onChosen={() => setVersion(Date.now())} />
      </div>
      {children}
      <div className="space-y-2">
        <KitEditor
          brandId={brandId}
          kit={kit}
          logoPalette={fromLogo}
          hasLogo={path !== null}
          businessName={businessName}
          fontFaces={fontFaces}
          textLogoSvg={textLogoSvg}
          themePreviews={themePreviews}
        />
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
    <div className="space-y-2 rounded-xl border border-coral/40 bg-coral-50 p-3" data-offer="website-logo">
      <p className="font-medium">{t.offerTitle}</p>
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
