"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createPlanAction } from "@/app/(app)/plan/actions";
import { PlanPhotoField, type PlanPhoto } from "@/components/plan/photo-field";
import { WEEKDAYS, WEEKDAY_LABEL, emptyWeek, offerWords, parseWeek, weekDates, type PlanDayInput, type Weekday } from "@/lib/plans/parse";

export interface PlanFormProps {
  brandId: string;
  photos: PlanPhoto[];
  starts: { value: string; label: string }[];
  currency: string;
}

const CHANNELS: { id: string; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "whatsapp", label: "WhatsApp status" },
];
const CTAS: { id: string; label: string }[] = [
  { id: "whatsapp", label: "Order on WhatsApp" },
  { id: "call", label: "Call to order" },
  { id: "visit", label: "Visit us" },
  { id: "order", label: "Order now" },
];
const EXAMPLES = ["Mon 10%, Tue 20%, Wed 30%, Fri 10%, Sat & Sun 15% off on all cakes", "Weekdays ₹50 off, weekend buy 1 get 1 free on pastries", "Every day 10% off on coffee"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const card = "rounded-[20px] border border-line-light bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.03)]";

/** What the form sends to createPlanAction (the photo choice lands in the plan settings as photoId). */
export function planPayload(f: { start: string; on: string; days: (PlanDayInput & { what?: string })[]; channels: string[]; cta: string; time: string; photoId: string | null }) {
  return { title: "Weekly offers", start: f.start, on: f.on, days: f.days.map((d) => ({ ...d, text: d.text ?? "", what: d.what ?? "" })), channels: f.channels, cta: f.cta, time: f.time, photoId: f.photoId };
}

export function PlanForm({ brandId, photos, starts, currency }: PlanFormProps) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [days, setDays] = useState<(PlanDayInput & { what?: string })[]>(emptyWeek());
  const [on, setOn] = useState("");
  const [start, setStart] = useState(starts[0]?.value ?? "");
  const [channels, setChannels] = useState<string[]>(["instagram"]);
  const [cta, setCta] = useState<string>("whatsapp");
  const [time, setTime] = useState("09:00");
  const [photoId, setPhotoId] = useState<string | null>(photos[0]?.id ?? null);
  const [read, setRead] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = useMemo(() => (start ? weekDates(start) : null), [start]);
  const chosen = days.filter((d) => d.on && (d.kind === "text" ? d.text.trim() : d.value)).sort((a, b) => (dates ? dates[a.day].localeCompare(dates[b.day]) : 0));

  function readWeek(text = sentence) {
    const r = parseWeek(text);
    const n = r.days.filter((d) => d.on).length;
    if (n === 0) {
      setRead("We could not find days with offers in that. Try “Mon 10%, Tue 20% …”, or fill the days below.");
      return;
    }
    setDays(r.days);
    if (r.on) setOn(r.on);
    setRead(`Got it: ${n} day${n === 1 ? "" : "s"} with offers${r.on ? ` on ${r.on}` : ""}.${r.unread.length ? ` We skipped: “${r.unread.join("”, “")}”.` : ""} Check them below.`);
  }

  function setDay(day: Weekday, patch: Partial<PlanDayInput & { what?: string }>) {
    setDays((all) => all.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await createPlanAction(planPayload({ start, on, days, channels, cta, time, photoId }));
    if (!r.ok) {
      setBusy(false);
      setError(r.message);
      return;
    }
    router.push(`/plan/${r.id}/design`);
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <section className={`${card} bg-gradient-to-br from-hero-from via-hero-via to-white`}>
          <h2 className="text-[18px] font-semibold text-title">Tell us your week in one line</h2>
          <p className="mt-1 text-[13.5px] leading-5 text-desc">Say it the way you would tell a friend. We fill in each day for you; nothing is made up.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <textarea
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              rows={2}
              placeholder="Monday 10% off, Tuesday 20%, Wednesday 30%, Friday 10%, Saturday and Sunday 15% on all cakes"
              className="min-h-[64px] flex-1 resize-none rounded-2xl border border-line-input bg-white px-4 py-3 text-[15px] leading-6 focus:border-ink"
              data-plan-sentence
            />
            <button type="button" onClick={() => readWeek()} disabled={!sentence.trim()} className="h-12 shrink-0 rounded-full bg-ink px-5 text-[14px] font-medium text-white hover:bg-ink-2 disabled:bg-faint sm:self-end" data-plan-read>
              Fill my week
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => { setSentence(ex); readWeek(ex); }} className="rounded-full bg-white/80 px-3 py-1 text-[12px] text-sub ring-1 ring-line-light hover:text-ink">
                {ex}
              </button>
            ))}
          </div>
          {read ? <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[13px] text-ok-tx ring-1 ring-ok-bd" role="status">{read}</p> : null}
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-semibold text-title">Offers by day</h2>
              <p className="text-[13px] text-desc">Tap a day to switch it on. Each day gets its own post.</p>
            </div>
            <label className="text-[12.5px] text-sub">
              Week of
              <select value={start} onChange={(e) => setStart(e.target.value)} className="ml-2 h-9 rounded-lg border border-line-input px-2 text-[13px] text-ink">
                {starts.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" data-plan-days>
            {[...WEEKDAYS].sort((a, b) => (dates ? dates[a].localeCompare(dates[b]) : 0)).map((wd) => {
              const d = days.find((x) => x.day === wd)!;
              const date = dates?.[wd];
              return (
                <div key={wd} className={`rounded-2xl border p-2.5 transition ${d.on ? "border-coral bg-coral-50" : "border-line-light bg-cream"}`} data-day={wd}>
                  <button type="button" onClick={() => setDay(wd, { on: !d.on, value: d.value ?? (d.kind === "text" ? null : 10) })} className="flex w-full items-center justify-between text-left" aria-pressed={d.on}>
                    <span>
                      <span className="block text-[13.5px] font-semibold text-ink">{WEEKDAY_LABEL[wd].slice(0, 3)}</span>
                      <span className="block text-[11px] text-desc">{date ? `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}` : ""}</span>
                    </span>
                    <span className={`h-5 w-9 rounded-full p-0.5 transition ${d.on ? "bg-coral" : "bg-edge"}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white shadow transition ${d.on ? "translate-x-4" : ""}`} />
                    </span>
                  </button>
                  {d.on ? (
                    <div className="mt-2 space-y-1.5">
                      {d.kind === "text" ? (
                        <input value={d.text} onChange={(e) => setDay(wd, { text: e.target.value })} placeholder="Buy 1 get 1" className="h-9 w-full rounded-lg border border-line-input bg-white px-2 text-[13px]" aria-label={`${WEEKDAY_LABEL[wd]} offer`} />
                      ) : (
                        <div className="flex h-9 items-center rounded-lg border border-line-input bg-white pr-1">
                          {d.kind === "amount" ? <span className="pl-2 text-[14px] text-desc">{currency === "INR" ? "₹" : currency}</span> : null}
                          <input type="number" min={1} max={d.kind === "percent" ? 100 : 100000} value={d.value ?? ""} onChange={(e) => setDay(wd, { value: e.target.value ? Number(e.target.value) : null })} className="h-full w-full min-w-0 rounded-lg bg-transparent px-2 text-[16px] font-semibold tabular-nums outline-none" aria-label={`${WEEKDAY_LABEL[wd]} amount`} />
                          {d.kind === "percent" ? <span className="pr-1 text-[14px] text-desc">%</span> : null}
                        </div>
                      )}
                      <div className="flex gap-0.5 rounded-md bg-white/70 p-0.5 text-[11px]">
                        {(["percent", "amount", "text"] as const).map((k) => (
                          <button key={k} type="button" onClick={() => setDay(wd, { kind: k })} className={`flex-1 rounded px-1 py-0.5 font-medium ${d.kind === k ? "bg-ink text-white" : "text-sub hover:text-ink"}`}>
                            {k === "percent" ? "%" : k === "amount" ? (currency === "INR" ? "₹" : currency) : "Text"}
                          </button>
                        ))}
                      </div>
                      <p className="truncate text-[11.5px] font-semibold text-coral-dark">{offerWords(d, currency) || " "}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-faint">No post</p>
                  )}
                </div>
              );
            })}
          </div>
          <label className="mt-4 block">
            <span className="text-[13px] font-medium text-ink">What are the offers on?</span>
            <input value={on} onChange={(e) => setOn(e.target.value)} placeholder="all cakes" className="mt-1 h-10 w-full rounded-xl border border-line-input px-3 text-[14px]" />
          </label>
        </section>

        <section className={card}>
          <h2 className="text-[16px] font-semibold text-title">Photo for the week</h2>
          <p className="text-[13px] text-desc">Optional. You can upload or swap photos in the design studio, and blend them into the poster.</p>
          <PlanPhotoField brandId={brandId} photos={photos} photoId={photoId} onChange={setPhotoId} />
        </section>
      </div>

      <aside className={`${card} space-y-4 lg:sticky lg:top-[64px]`}>
        <div>
          <h2 className="text-[16px] font-semibold text-title">Posting</h2>
          <p className="text-[12.5px] text-desc">Each post goes out at this time on its day, after you approve the week.</p>
        </div>
        <label className="block">
          <span className="text-[13px] font-medium text-ink">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line-input px-3 text-[14px]" />
        </label>
        <fieldset>
          <legend className="text-[13px] font-medium text-ink">Where</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => {
              const onC = channels.includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={onC} onClick={() => setChannels((all) => (onC ? (all.length > 1 ? all.filter((x) => x !== c.id) : all) : [...all, c.id]))} className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ${onC ? "bg-ink text-white" : "bg-well text-sub hover:text-ink"}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-[13px] font-medium text-ink">Button on the post</span>
          <select value={cta} onChange={(e) => setCta(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line-input px-3 text-[14px]">
            {CTAS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-2xl bg-cream p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-desc">Your week</p>
          {chosen.length === 0 ? <p className="mt-1 text-[13px] text-desc">No days yet.</p> : null}
          <ul className="mt-1.5 space-y-1">
            {chosen.map((d) => (
              <li key={d.day} className="flex items-center justify-between text-[13px]">
                <span className="text-sub">{WEEKDAY_LABEL[d.day]}</span>
                <span className="font-semibold text-ink">{offerWords(d, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-divider pt-2 text-[12px] leading-[17px] text-desc">
            1 design → {chosen.length} posts → posted at {time} each day (or emailed to you ready to share, if a channel is not connected).
          </p>
        </div>
        {error ? (
          <p className="text-[13px] text-err-tx" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" disabled={busy || chosen.length === 0} onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[14px] font-medium text-white hover:bg-ink-2 disabled:bg-faint" data-plan-submit>
          {busy ? "Writing your posts…" : "Design my week"}
          {busy ? null : <span aria-hidden="true">→</span>}
        </button>
      </aside>
    </div>
  );
}
