"use client";

import { useState } from "react";
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/ai/schemas";
import { fill, s } from "@/lib/i18n/strings";
import type { ReviewOutput } from "@/lib/posts/review";
import { switchLanguageAction } from "./actions";

/**
 * The output cards of the result screen. Each card has a 3-way language switch (R5):
 * one tap rewrites that output only, then the card updates in place.
 * If it fails the old content stays and a plain message shows.
 */
export function OutputCards({ initial }: { initial: ReviewOutput[] }) {
  const [outputs, setOutputs] = useState(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  async function onSwitch(id: string, to: ContentLanguage) {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: null }));
    let message: string | null = null;
    try {
      const res = await switchLanguageAction(id, to);
      if (res.ok) {
        const next = res.output;
        setOutputs((all) =>
          all.map((o) => {
            if (o.id === next.id) return next;
            // Facebook starts out showing ig_feed's image: if that file was redrawn, reload it there too.
            if (next.imagePath && o.imagePath === next.imagePath) return { ...o, imageVersion: next.imageVersion };
            return o;
          }),
        );
      } else {
        message = res.message;
      }
    } catch {
      message = s.review.switch.failed;
    }
    setBusy((b) => ({ ...b, [id]: false }));
    if (message) setErrors((e) => ({ ...e, [id]: message }));
  }

  return (
    <>
      {outputs.map((o) => {
        const open = o.flags.filter((f) => f.status === "open");
        const label = s.review.channels[o.channel];
        const working = busy[o.id] === true;
        const error = errors[o.id];
        return (
          <article
            key={o.channel}
            data-channel={o.channel}
            data-language={o.language}
            aria-busy={working}
            className="space-y-3 rounded-xl border border-stone-200 p-3"
          >
            <h2 className="font-semibold">{label}</h2>

            <div data-slot="language-switch" className="space-y-2">
              <div role="radiogroup" aria-label={`${s.review.switch.label}: ${label}`} className="grid grid-cols-3 gap-2">
                {CONTENT_LANGUAGES.map((lang) => {
                  const selected = o.language === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={working}
                      onClick={() => {
                        if (!selected) void onSwitch(o.id, lang);
                      }}
                      className={`min-h-12 rounded-lg border px-2 py-2 text-base font-medium disabled:opacity-60 ${
                        selected
                          ? "border-[#E4572E] bg-[#E4572E]/10 text-[#B93A15]"
                          : "border-stone-300 bg-white text-stone-800"
                      }`}
                    >
                      {s.review.switch.options[lang]}
                    </button>
                  );
                })}
              </div>
              {working && (
                <p role="status" className="flex items-center gap-2 text-sm text-stone-600">
                  <span
                    aria-hidden="true"
                    className="inline-block size-4 animate-spin rounded-full border-2 border-stone-300 border-t-[#E4572E]"
                  />
                  {s.review.switch.working}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            {o.imagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${o.imagePath}?v=${o.imageVersion}`}
                alt={fill(s.review.imageAlt, { channel: label })}
                className={`w-full rounded-lg border border-stone-200 bg-stone-100 ${working ? "opacity-50" : ""}`}
              />
            ) : (
              <p className="text-sm text-stone-500">{s.review.textOnly}</p>
            )}

            {open.length > 0 && (
              <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="font-semibold">{s.review.pleaseCheck}:</p>
                <ul className="list-inside list-disc text-sm">
                  {open.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1 text-sm font-medium text-stone-600">{s.review.shareTextLabel}</p>
              <p className={`whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-base ${working ? "opacity-50" : ""}`}>
                {o.shareText}
              </p>
            </div>
          </article>
        );
      })}
    </>
  );
}
