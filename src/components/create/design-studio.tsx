"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  previewOptionAction,
  saveWordsAction,
  setBlockAction,
  setPhotoAction,
  chooseDesignAction,
} from "@/app/(app)/create/[briefId]/actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import type { DesignPageData, OptionView } from "@/lib/create";
import type { DesignOption } from "@/lib/design/types";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.design;
const SCHEMES: DesignOption["scheme"][] = ["primary", "light", "dark", "accent"];

const smallButton = "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";

/**
 * The design step (PRD v3 G-5 to G-7): three options for the first channel's main size, their reports (what
 * had no room), quick edits (layout, colours, photo, words, lines to show) and "Use this design", which draws
 * every size the channels need. Everything on a picture comes from the details; the words are checked again
 * when they are saved.
 */
export function DesignStudio({ data }: { data: DesignPageData }) {
  const router = useRouter();
  const [views, setViews] = useState<OptionView[]>(data.options);
  const [selected, setSelected] = useState(data.usedIndex ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const view = views[selected];
  const working = busy !== null || refreshing;

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function swap(next: DesignOption, name: string) {
    setBusy(name);
    setError(null);
    const r = await previewOptionAction(data.briefId, next);
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setViews((all) => all.map((v, i) => (i === selected ? r.view : v)));
  }

  const layoutAt = Math.max(0, view.layouts.findIndex((l) => l.id === view.used.layoutId));
  const moveLayout = (step: number) => {
    const next = view.layouts[(layoutAt + step + view.layouts.length) % view.layouts.length];
    if (next) void swap({ ...view.option, layoutId: next.id, scheme: view.used.scheme }, "layout");
  };

  async function chooseIt() {
    setBusy("use");
    setError(null);
    const r = await chooseDesignAction(data.briefId, { ...view.option, layoutId: view.used.layoutId, scheme: view.used.scheme });
    if (!r.ok) {
      setBusy(null);
      setError(r.message);
      return;
    }
    router.push(`/create/${data.briefId}/review`);
  }

  async function setPhoto(photoId: string | null) {
    setBusy("photo");
    setError(null);
    const r = await setPhotoAction(data.briefId, photoId);
    setBusy(null);
    if (!r.ok) setError(r.message);
    else refresh();
  }

  async function setBlock(key: string, on: boolean) {
    setBusy("block");
    setError(null);
    const r = await setBlockAction(data.briefId, key, on);
    setBusy(null);
    if (!r.ok) setError(r.message);
    else refresh();
  }

  return (
    <div className="space-y-6" data-design-studio aria-busy={working}>
      <p className="text-stone-700">{t.intro}</p>

      {data.designed ? <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{t.designedNote}</p> : null}

      <section className="space-y-3" aria-label={t.flagsTitle} data-design-flags>
        {data.flags.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <h2 className="font-semibold text-amber-900">{t.flagsTitle}</h2>
            <p className="text-sm text-stone-600">{t.flagsIntro}</p>
            <ul className="space-y-1">
              {data.flags.map(({ flag }) => (
                <li key={flag.id} className="text-sm">
                  <span className="text-stone-600">{s.approvals.flags.kinds[flag.kind]} · {fill(s.approvals.flags.where, { field: s.approvals.fieldNames[flag.field] })}: </span>
                  <mark className="rounded bg-amber-200 px-1 font-semibold">{flag.text}</mark>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm font-medium text-green-800">{t.flagsNone}</p>
        )}
      </section>

      <section className="space-y-3" aria-label="Design options">
        <ul className="grid gap-4 md:grid-cols-3">
          {views.map((v, i) => {
            const active = i === selected;
            return (
              <li key={`${v.option.themeId}-${v.option.layoutId}-${i}`} data-option={i} data-selected={active} className={`space-y-2 rounded-xl border bg-white p-3 ${active ? "border-[#E4572E] ring-2 ring-[#E4572E]/30" : "border-stone-200"}`}>
                <button type="button" className="block w-full" onClick={() => setSelected(i)} aria-pressed={active}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.src} alt={fill(t.previewAlt, { n: i + 1 })} className="w-full rounded-lg bg-stone-100 object-contain" />
                </button>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{fill(t.optionN, { n: i + 1 })}</h3>
                  <button type="button" className={smallButton} onClick={() => setSelected(i)} aria-pressed={active}>
                    {active ? t.selected : t.choose}
                  </button>
                </div>
                <div className="space-y-1 text-sm" data-option-report>
                  {v.lines.problems.map((p) => (
                    <p key={p} className="font-medium text-red-700">{p}</p>
                  ))}
                  {v.lines.noRoom.length > 0 ? <p className="text-amber-800">{fill(t.noRoom, { items: v.lines.noRoom.join(", ") })}</p> : null}
                  {v.lines.notShown.length > 0 ? <p className="text-stone-600">{fill(t.notShown, { items: v.lines.notShown.join(", ") })}</p> : null}
                  {v.lines.problems.length === 0 && v.lines.noRoom.length === 0 && v.lines.notShown.length === 0 ? <p className="text-green-800">{t.fits}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className={hintClass}>{fill(t.formats, { list: data.formats.map((f) => t.formatNames[f]).join(", ") })}</p>
        {data.carousel ? <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{t.carousel}</p> : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4" aria-label={t.quick.title}>
        <h2 className="text-lg font-bold">{t.quick.title}</h2>

        <div className="space-y-2">
          <h3 className="font-semibold">{t.quick.layout}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={smallButton} disabled={working || view.layouts.length < 2} onClick={() => moveLayout(-1)}>
              {t.quick.previous}
            </button>
            <button type="button" className={smallButton} disabled={working || view.layouts.length < 2} onClick={() => moveLayout(1)}>
              {t.quick.next}
            </button>
            <span className="text-sm text-stone-600" data-layout-label>
              {fill(t.quick.layoutOf, { n: layoutAt + 1, total: view.layouts.length, name: view.layouts[layoutAt]?.name ?? view.used.layoutId })}
            </span>
          </div>
          <div>
            <label className={labelClass} htmlFor="scheme">{t.quick.scheme}</label>
            <select id="scheme" className={`${inputClass} md:max-w-xs`} value={view.used.scheme} disabled={working} onChange={(ev) => void swap({ ...view.option, layoutId: view.used.layoutId, scheme: ev.target.value as DesignOption["scheme"] }, "scheme")}>
              {SCHEMES.map((sc) => (
                <option key={sc} value={sc}>{t.quick.schemes[sc]}</option>
              ))}
            </select>
          </div>
          <p className={hintClass}>{t.quick.logoCornerNote}</p>
        </div>

        <fieldset className="space-y-2" disabled={working}>
          <legend className="font-semibold">{t.quick.photo}</legend>
          <p className={hintClass}>{t.quick.photoNote}</p>
          {data.photos.length === 0 ? <p className="text-sm text-stone-600">{t.quick.photoEmpty}</p> : null}
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {data.photos.map((p) => (
              <label key={p.id} className={`block cursor-pointer rounded-lg border p-1 text-center text-xs ${data.photoId === p.id ? "border-[#E4572E] ring-2 ring-[#E4572E]/30" : "border-stone-200"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.description} className="aspect-square w-full rounded object-cover" />
                <input type="radio" name="photo" className="mt-1 size-5" checked={data.photoId === p.id} onChange={() => void setPhoto(p.id)} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2">
            <input type="radio" name="photo" className="size-5" checked={data.photoId === null} onChange={() => void setPhoto(null)} />
            <span>{t.quick.photoNone}</span>
          </label>
        </fieldset>

        <fieldset className="space-y-2" disabled={working}>
          <legend className="font-semibold">{t.quick.blocks}</legend>
          <p className={hintClass}>{t.quick.blocksHint}</p>
          <ul className="space-y-1">
            {data.blocks.map((blk) => (
              <li key={blk.key} data-block={blk.key}>
                <label className="flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-2">
                  <input type="checkbox" className="mt-1 size-5" checked={blk.on} disabled={blk.text === null} onChange={(ev) => void setBlock(blk.key, ev.target.checked)} />
                  <span>
                    <span className="block font-medium">{blk.label}</span>
                    <span className="block text-sm text-stone-600">{blk.text ?? t.quick.notAdded}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </section>

      <WordsForm data={data} disabled={working} onSaved={refresh} />

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-use-design className={primaryButton} disabled={working || view.lines.problems.length > 0} onClick={() => void chooseIt()}>
          {busy === "use" ? t.using : t.useThis}
        </button>
        <Link href={`/create/${data.briefId}`} className={`${secondaryButton} inline-block text-center`}>
          {t.back}
        </Link>
        {busy === "use" ? <span className={hintClass}>{t.usingHint}</span> : null}
        {view.lines.problems.length > 0 ? <span className="text-sm font-medium text-red-700">{t.problems}</span> : null}
        {refreshing ? <span className={hintClass} role="status">{t.writingTitle}</span> : null}
      </div>
    </div>
  );
}

/** The headline, second line, button text, mascot line and each channel's caption: saved and checked again. */
function WordsForm({ data, disabled, onSaved }: { data: DesignPageData; disabled: boolean; onSaved: () => void }) {
  const w = t.words;
  const [headline, setHeadline] = useState(data.words.headline);
  const [subline, setSubline] = useState(data.words.subline);
  const [ctaText, setCtaText] = useState(data.words.ctaText);
  const [bubble, setBubble] = useState(data.words.bubble);
  const [captions, setCaptions] = useState<Record<string, string>>(Object.fromEntries(data.captions.map((c) => [c.channel, c.caption])));
  const [hashtags, setHashtags] = useState([...data.captions].sort((a, b) => b.hashtags.length - a.hashtags.length)[0]?.hashtags.join(" ") ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const r = await saveWordsAction(data.briefId, { headline, subline, ctaText, bubble: data.hasMascot ? bubble : undefined, captions, hashtags });
    setSaving(false);
    if (!r.ok) {
      setMessage({ ok: false, lines: r.errors });
      return;
    }
    setMessage({ ok: true, lines: data.designed && r.changed ? [r.message, t.stale] : [r.message] });
    if (r.changed) onSaved();
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <h2 className="text-lg font-bold">{w.title}</h2>
      <p className={hintClass}>{w.hint}</p>
      <div>
        <label className={labelClass} htmlFor="words-headline">{w.headline}</label>
        <input id="words-headline" className={inputClass} value={headline} onChange={(ev) => setHeadline(ev.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="words-subline">{w.subline}</label>
        <input id="words-subline" className={inputClass} value={subline} onChange={(ev) => setSubline(ev.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="words-cta">{w.cta}</label>
        <input id="words-cta" className={inputClass} value={ctaText} onChange={(ev) => setCtaText(ev.target.value)} />
      </div>
      {data.hasMascot ? (
        <div>
          <label className={labelClass} htmlFor="words-bubble">{w.bubble}</label>
          <input id="words-bubble" className={inputClass} value={bubble} onChange={(ev) => setBubble(ev.target.value)} />
        </div>
      ) : null}
      {data.captions.map((c) => (
        <div key={c.postId}>
          <label className={labelClass} htmlFor={`words-cap-${c.channel}`}>{fill(w.caption, { channel: c.label })}</label>
          <textarea id={`words-cap-${c.channel}`} className={inputClass} rows={5} value={captions[c.channel] ?? ""} onChange={(ev) => setCaptions({ ...captions, [c.channel]: ev.target.value })} />
        </div>
      ))}
      <div>
        <label className={labelClass} htmlFor="words-tags">{w.hashtags}</label>
        <input id="words-tags" className={inputClass} value={hashtags} onChange={(ev) => setHashtags(ev.target.value)} />
      </div>
      <button type="submit" className={secondaryButton} disabled={disabled || saving}>
        {saving ? w.saving : w.save}
      </button>
      {message ? (
        <div role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm font-medium text-green-800" : errorClass}>
          {message.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
