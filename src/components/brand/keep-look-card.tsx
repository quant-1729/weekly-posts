"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { keepLookAction, readLookAction } from "@/app/(app)/brand/style-actions";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import type { StyleResult } from "@/lib/style/read";
import { fontLabels, styleCopy, themeLabels } from "@/lib/style/copy";

const t = styleCopy.card;

/** Where "Try a fresh look" scrolls to: the theme cards of the Look section (falls back to the section itself). */
export const THEME_CARDS_ID = "look-themes";

function Swatches({ colors }: { colors: Record<string, string> }) {
  return (
    <ul className="flex flex-wrap gap-3" aria-label={t.colours}>
      {Object.entries(colors).map(([name, hex]) => (
        <li key={name} className="flex items-center gap-2 text-sm text-stone-700">
          <span className="h-8 w-8 rounded-md border border-stone-300" style={{ background: hex }} aria-hidden="true" />
          <span>
            <span className="capitalize">{name}</span> <span className="text-stone-500">{hex}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function scrollToThemes() {
  const el = document.getElementById(THEME_CARDS_ID) ?? document.getElementById("look");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** "Keep my look / Try a fresh look" card for the Look section of the Brand page (C-17). Reads only when the owner taps. */
export function KeepMyLookCard({ brandId, initial = null }: { brandId: string; initial?: StyleResult | null }) {
  const router = useRouter();
  const [result, setResult] = useState<StyleResult | null>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function read() {
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const res = await readLookAction(brandId);
      if (res.ok) setResult(res.result);
      else setMessage({ ok: false, text: res.message || t.failed });
    });
  }

  function keep() {
    const kit = result?.suggestion?.kit;
    if (!kit) return;
    setMessage(null);
    startTransition(async () => {
      const res = await keepLookAction(brandId, kit);
      if (res.ok) {
        setSaved(true);
        setMessage({ ok: true, text: t.saved });
        router.refresh();
      } else setMessage({ ok: false, text: res.message || t.saveFailed });
    });
  }

  const suggestion = result?.suggestion ?? null;
  const kit = suggestion?.clear ? suggestion.kit : null;

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4" data-keep-look>
      <div>
        <h3 className="font-medium">{t.title}</h3>
        <p className={hintClass}>{t.intro}</p>
      </div>

      {!result && (
        <button type="button" className={secondaryButton} onClick={read} disabled={pending}>
          {pending ? t.reading : t.read}
        </button>
      )}

      {result && (
        <div className="space-y-3" aria-live="polite">
          {result.note && <p className="text-sm text-stone-700">{result.note}</p>}
          {kit && result.read && (
            <>
              <p className="text-base">{result.read.summary}</p>
              <p className="text-sm text-stone-600">
                {t.from}{" "}
                {[result.counts.fromInstagram + result.counts.fromPhotos > 0 ? t.fromInstagram(result.counts.fromInstagram + result.counts.fromPhotos) : null, result.counts.websiteColors > 0 ? t.fromWebsite : null]
                  .filter(Boolean)
                  .join(" + ")}
              </p>
              <Swatches colors={kit.colors} />
              <p className="text-sm text-stone-700">
                <span className="font-medium">{t.theme}:</span> {themeLabels[kit.themeId] ?? kit.themeId}
                {" · "}
                <span className="font-medium">{t.fonts}:</span> {fontLabels[kit.fonts.headline] ?? kit.fonts.headline} ({t.headlineFont}), {fontLabels[kit.fonts.body] ?? kit.fonts.body} ({t.bodyFont})
              </p>
              {suggestion && suggestion.notes.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {suggestion.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex flex-col gap-2 md:flex-row">
            {kit && (
              <button type="button" className={primaryButton} onClick={keep} disabled={pending || saved}>
                {pending ? t.keeping : t.keep}
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={scrollToThemes} disabled={pending}>
              {t.fresh}
            </button>
            {result.status === "ok" && (
              <button type="button" className={secondaryButton} onClick={read} disabled={pending}>
                {t.read}
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={message.ok ? "text-sm text-green-800" : errorClass}>
          {message.text}
        </p>
      )}
    </div>
  );
}
