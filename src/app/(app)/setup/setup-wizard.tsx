"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { regionOfLocale, type CountryOption } from "@/lib/setup/countries";
import { defaultPostLanguage, type LanguageOption } from "@/lib/setup/languages";
import type { RegionOption } from "@/lib/setup/regions";
import {
  DEFAULT_TIME,
  DEFAULT_WEEKDAY,
  GOALS,
  TONES,
  fieldError,
  normalizeWebsiteInput,
  type Goal,
  type Tone,
} from "@/lib/setup/schema";
import { MINUTE_PICKS, SETUP_STEPS, type SetupStep } from "@/lib/setup/steps";
import {
  allTimezones,
  browserTimezone,
  countryOfTimezone,
  describeTimezone,
  normalizeTimezone,
} from "@/lib/setup/timezones";
import type { WebsiteReadSummary } from "@/lib/setup/website";
import { completeSetupAction, startWebsiteReadAction, websiteStatusAction } from "./actions";

/**
 * Setup v2 (Req 2, 7): ten short screens, one question each, with a progress bar.
 *
 *   business -> customers -> location -> goal -> tone -> language -> minutes
 *     -> website (optional) -> schedule -> done
 *
 * A website address starts a background read the moment it is entered (step 8); the owner
 * carries on and the result shows on the last screen. Setup never waits for it (Req 6).
 */

const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 60_000;

const t = s.setupV2;

interface Props {
  countries: CountryOption[];
  /** Country -> regions ("US-OR"), only for countries that have any. */
  regions: Record<string, RegionOption[]>;
  /** Country -> IANA zones. */
  zonesByCountry: Record<string, string[]>;
  languages: LanguageOption[];
}

function errorText(code: string | null): string | null {
  if (!code) return null;
  const table = t.errors as Record<string, string>;
  return table[code] ?? t.errors.invalid;
}

export function SetupWizard({ countries, regions, zonesByCountry, languages }: Props) {
  const [step, setStep] = useState<SetupStep>("business");
  const [name, setName] = useState("");
  const [sell, setSell] = useState("");
  const [customers, setCustomers] = useState("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("");
  const [showZones, setShowZones] = useState(false);
  const [goal, setGoal] = useState<Goal | "">("");
  const [tone, setTone] = useState<Tone | "">("");
  const [language, setLanguage] = useState("en");
  const [minutes, setMinutes] = useState("");
  const [website, setWebsite] = useState("");
  const [weekday, setWeekday] = useState<number>(DEFAULT_WEEKDAY);
  const [time, setTime] = useState(DEFAULT_TIME);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [summary, setSummary] = useState<WebsiteReadSummary | null>(null);
  const [pollGaveUp, setPollGaveUp] = useState(false);

  // What the owner has changed by hand is never overwritten by a default.
  const touched = useRef({ timezone: false, language: false });
  const browserTz = useRef("");
  // The website read started at step 8, so "Finish" can wait for the start call (not the read).
  const readStart = useRef<Promise<unknown>>(Promise.resolve());
  const readStartedFor = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Defaults from the browser: time zone, then country (from the zone, else the locale).
  useEffect(() => {
    const tz = browserTimezone();
    browserTz.current = tz;
    const guess = (tz && countryOfTimezone(tz, zonesByCountry)) || regionOfLocale(navigator.language);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only defaults, cannot be known on the server
    if (tz) setTimezone(tz);
    if (guess) {
      setCountry(guess);
      setLanguage(defaultPostLanguage(guess));
    }
  }, [zonesByCountry]);

  // Each screen starts at the top with its heading read out.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const stepIndex = SETUP_STEPS.indexOf(step);
  const total = SETUP_STEPS.length;

  const zoneChoices = useMemo(() => {
    const list = zonesByCountry[country]?.length ? zonesByCountry[country] : allTimezones();
    return timezone && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [zonesByCountry, country, timezone]);

  function chooseCountry(code: string) {
    setCountry(code);
    setRegion("");
    if (!touched.current.language) setLanguage(defaultPostLanguage(code));
    const zones = zonesByCountry[code];
    if (!touched.current.timezone && zones?.length) {
      setTimezone(zones.includes(browserTz.current) ? browserTz.current : zones[0]);
    }
  }

  function goTo(next: SetupStep) {
    setSaveError(null);
    setStep(next);
  }
  const back = () => goTo(SETUP_STEPS[Math.max(0, stepIndex - 1)]);
  const next = () => goTo(SETUP_STEPS[Math.min(total - 1, stepIndex + 1)]);

  // ---- website: start reading as soon as it is entered ------------------------------------

  function startRead() {
    const url = normalizeWebsiteInput(website);
    if (!url || readStartedFor.current === url) return;
    readStartedFor.current = url;
    const businessName = name.trim();
    // Chained so two taps cannot race each other; a failed start is not shown (Req 6).
    readStart.current = readStart.current
      .then(() => startWebsiteReadAction({ businessName, url }))
      .catch(() => undefined);
  }

  // ---- finish ------------------------------------------------------------------------------

  async function finish() {
    setSaving(true);
    setSaveError(null);
    try {
      await readStart.current; // only the start call, never the read itself
      const url = normalizeWebsiteInput(website);
      const res = await completeSetupAction({
        business_name: name,
        what_sell: sell,
        customers,
        country,
        region,
        city,
        timezone,
        goal,
        tone,
        post_language: language,
        minutes_per_post: Number(minutes),
        website_url: url,
        schedule_weekday: weekday,
        schedule_time: time,
      });
      if (!res.ok) {
        setSaveError(res.message);
        return;
      }
      setHasWebsite(res.hasWebsite);
      goTo("done");
    } catch {
      setSaveError(s.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  // ---- Done: show how the website read went, polling every 2 s for up to 60 s -------------

  useEffect(() => {
    if (step !== "done" || !hasWebsite) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    async function tick() {
      try {
        const res = await websiteStatusAction();
        if (cancelled) return;
        if (res.ok) setSummary(res.summary);
        if (res.ok && res.summary.state !== "reading") return;
      } catch {
        if (cancelled) return;
      }
      if (Date.now() - startedAt >= POLL_FOR_MS) {
        setPollGaveUp(true);
        return;
      }
      timer = setTimeout(() => void tick(), POLL_EVERY_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, hasWebsite]);

  // ---- per-screen checks -------------------------------------------------------------------

  const errs = {
    name: fieldError("business_name", name),
    sell: fieldError("what_sell", sell),
    customers: fieldError("customers", customers),
    country: fieldError("country", country),
    timezone: fieldError("timezone", timezone),
    language: fieldError("post_language", language),
    minutes: fieldError("minutes_per_post", minutes === "" ? undefined : Number(minutes)),
    website: website.trim() === "" ? "required" : fieldError("website_url", website),
  };
  const regionList = regions[country] ?? [];

  // ---- screens -----------------------------------------------------------------------------

  const shell = (title: string, body: React.ReactNode, footer: React.ReactNode, stack = false) => (
    <section className="space-y-5">
      <div
        role="progressbar"
        aria-label={t.progressLabel}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={stepIndex + 1}
        aria-valuetext={fill(t.progress, { n: stepIndex + 1, total })}
        className="h-2 w-full rounded-full bg-stone-200"
      >
        <div
          className="h-2 rounded-full bg-[#E4572E] transition-all"
          style={{ width: `${((stepIndex + 1) / total) * 100}%` }}
        />
      </div>
      <p className="text-sm text-stone-500">{fill(t.progress, { n: stepIndex + 1, total })}</p>
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
        {title}
      </h1>
      {body}
      {saveError && (
        <p role="alert" className={errorClass}>
          {saveError}
        </p>
      )}
      <div className={stack ? "flex flex-col gap-3" : "flex gap-3"}>{footer}</div>
    </section>
  );

  const backButton = (
    <button type="button" className={secondaryButton} onClick={back}>
      {t.back}
    </button>
  );
  const nextButton = (ok: boolean, label: string = t.next, onClick: () => void = next) => (
    <button type="button" className={primaryButton} disabled={!ok} onClick={onClick}>
      {label}
    </button>
  );

  if (step === "business") {
    return shell(
      t.business.title,
      <div className="space-y-4">
        <div>
          <label htmlFor="sv2-name" className={labelClass}>
            {t.business.nameLabel}
          </label>
          <input
            id="sv2-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.business.namePlaceholder}
            maxLength={100}
            autoComplete="organization"
          />
        </div>
        <div>
          <label htmlFor="sv2-sell" className={labelClass}>
            {t.business.sellLabel}
          </label>
          <p id="sv2-sell-hint" className={hintClass}>
            {t.business.sellHint}
          </p>
          <input
            id="sv2-sell"
            aria-describedby="sv2-sell-hint"
            className={inputClass}
            value={sell}
            onChange={(e) => setSell(e.target.value)}
            placeholder={t.business.sellPlaceholder}
            maxLength={200}
          />
        </div>
      </div>,
      nextButton(!errs.name && !errs.sell),
    );
  }

  if (step === "customers") {
    return shell(
      t.customers.title,
      <div>
        <label htmlFor="sv2-customers" className={labelClass}>
          {t.customers.label}
        </label>
        <p id="sv2-customers-hint" className={hintClass}>
          {t.customers.hint}
        </p>
        <input
          id="sv2-customers"
          aria-describedby="sv2-customers-hint"
          className={inputClass}
          value={customers}
          onChange={(e) => setCustomers(e.target.value)}
          placeholder={t.customers.placeholder}
          maxLength={200}
        />
      </div>,
      <>
        {backButton}
        {nextButton(!errs.customers)}
      </>,
    );
  }

  if (step === "location") {
    return shell(
      t.location.title,
      <div className="space-y-4">
        <div>
          <label htmlFor="sv2-country" className={labelClass}>
            {t.location.countryLabel}
          </label>
          <select
            id="sv2-country"
            className={inputClass}
            value={country}
            onChange={(e) => chooseCountry(e.target.value)}
            autoComplete="country"
          >
            <option value="">{t.location.countryPlaceholder}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {regionList.length > 0 && (
          <div>
            <label htmlFor="sv2-region" className={labelClass}>
              {t.location.regionLabel}
            </label>
            <p className={hintClass}>{t.location.regionHint}</p>
            <select id="sv2-region" className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t.location.regionPlaceholder}</option>
              {regionList.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="sv2-city" className={labelClass}>
            {t.location.cityLabel}
          </label>
          <p className={hintClass}>{t.location.cityHint}</p>
          <input
            id="sv2-city"
            className={inputClass}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t.location.cityPlaceholder}
            maxLength={100}
            autoComplete="address-level2"
          />
        </div>
        <div>
          {timezone && (
            <p className="text-stone-700">{fill(t.location.timezoneIs, { zone: describeTimezone(timezone) })}</p>
          )}
          {showZones ? (
            <div className="mt-2">
              <label htmlFor="sv2-tz" className={labelClass}>
                {t.location.timezoneLabel}
              </label>
              <select
                id="sv2-tz"
                className={inputClass}
                value={timezone}
                onChange={(e) => {
                  touched.current.timezone = true;
                  setTimezone(normalizeTimezone(e.target.value));
                }}
              >
                {zoneChoices.map((z) => (
                  <option key={z} value={z}>
                    {describeTimezone(z)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button type="button" className="py-2 text-sm text-stone-600 underline" onClick={() => setShowZones(true)}>
              {t.location.timezoneChange}
            </button>
          )}
        </div>
      </div>,
      <>
        {backButton}
        {nextButton(!errs.country && !errs.timezone)}
      </>,
    );
  }

  if (step === "goal") {
    return shell(
      t.goal.title,
      <div role="radiogroup" aria-label={t.goal.title} className="space-y-3">
        {GOALS.map((g) => (
          <ChoiceCard
            key={g}
            selected={goal === g}
            label={t.goal.options[g].label}
            hint={t.goal.options[g].hint}
            onSelect={() => setGoal(g)}
          />
        ))}
      </div>,
      <>
        {backButton}
        {nextButton(goal !== "")}
      </>,
    );
  }

  if (step === "tone") {
    return shell(
      t.tone.title,
      <div className="space-y-3">
        <div role="radiogroup" aria-label={t.tone.title} className="space-y-3">
          {TONES.map((k) => (
            <ChoiceCard
              key={k}
              selected={tone === k}
              label={t.tone.options[k].label}
              hint={t.tone.options[k].hint}
              onSelect={() => setTone(k)}
            />
          ))}
        </div>
        {tone === "like_past_posts" && (
          <p role="status" className="rounded-lg bg-stone-50 p-3 text-stone-700">
            {t.tone.pastPostsNote}
          </p>
        )}
      </div>,
      <>
        {backButton}
        {nextButton(tone !== "")}
      </>,
    );
  }

  if (step === "language") {
    return shell(
      t.language.title,
      <div>
        <label htmlFor="sv2-language" className={labelClass}>
          {t.language.label}
        </label>
        <p className={hintClass}>{t.language.hint}</p>
        <select
          id="sv2-language"
          className={inputClass}
          value={language}
          onChange={(e) => {
            touched.current.language = true;
            setLanguage(e.target.value);
          }}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>,
      <>
        {backButton}
        {nextButton(!errs.language)}
      </>,
    );
  }

  if (step === "minutes") {
    return shell(
      t.minutes.title,
      <div className="space-y-3">
        <div>
          <label htmlFor="sv2-minutes" className={labelClass}>
            {t.minutes.label}
          </label>
          <p className={hintClass}>{t.minutes.hint}</p>
          <input
            id="sv2-minutes"
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          {minutes !== "" && errs.minutes && (
            <p role="alert" className={errorClass}>
              {errorText(errs.minutes)}
            </p>
          )}
        </div>
        <div role="group" aria-label={t.minutes.quickPicks} className="flex flex-wrap gap-2">
          {MINUTE_PICKS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={minutes === String(m)}
              onClick={() => setMinutes(String(m))}
              className={`min-h-12 rounded-lg border px-4 py-2 text-base font-medium ${
                minutes === String(m)
                  ? "border-[#E4572E] bg-[#E4572E]/10 text-[#B93A15]"
                  : "border-stone-300 bg-white text-stone-800"
              }`}
            >
              {fill(t.minutes.minutesUnit, { n: m })}
            </button>
          ))}
        </div>
      </div>,
      <>
        {backButton}
        {nextButton(!errs.minutes)}
      </>,
    );
  }

  if (step === "website") {
    const typed = website.trim() !== "";
    const bad = typed && errs.website;
    return shell(
      t.website.title,
      <div>
        <label htmlFor="sv2-website" className={labelClass}>
          {t.website.label}
        </label>
        <p id="sv2-website-hint" className={hintClass}>
          {t.website.hint}
        </p>
        <input
          id="sv2-website"
          aria-describedby="sv2-website-hint"
          className={inputClass}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder={t.website.placeholder}
          maxLength={2000}
        />
        {bad && (
          <p role="alert" className={errorClass}>
            {errorText(errs.website)}
          </p>
        )}
      </div>,
      <>
        <button
          type="button"
          className={primaryButton}
          disabled={!typed || !!errs.website}
          onClick={() => {
            startRead();
            next();
          }}
        >
          {t.website.next}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setWebsite("");
            next();
          }}
        >
          {t.website.skip}
        </button>
        {backButton}
      </>,
      true,
    );
  }

  if (step === "schedule") {
    return shell(
      t.schedule.title,
      <div className="space-y-4">
        <div>
          <label htmlFor="sv2-day" className={labelClass}>
            {t.schedule.dayLabel}
          </label>
          <select
            id="sv2-day"
            className={inputClass}
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {t.schedule.weekdays.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sv2-time" className={labelClass}>
            {t.schedule.timeLabel}
          </label>
          <input
            id="sv2-time"
            className={inputClass}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <p className={hintClass}>{fill(t.schedule.zoneNote, { zone: describeTimezone(timezone || "UTC") })}</p>
      </div>,
      <>
        <button type="button" className={secondaryButton} onClick={back} disabled={saving}>
          {t.back}
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || saving}
          onClick={() => void finish()}
        >
          {saving ? t.saving : t.schedule.finish}
        </button>
      </>,
    );
  }

  // done
  return shell(
    t.done.title,
    <div className="space-y-4">
      <p className="text-stone-700">
        {fill(t.done.body, { day: t.schedule.weekdays[weekday - 1], time })}
      </p>
      {hasWebsite && <WebsiteStatus summary={summary} gaveUp={pollGaveUp} />}
    </div>,
    <Link href="/brand" className={`${primaryButton} block text-center`}>
      {t.done.goToBrand}
    </Link>,
  );
}

function ChoiceCard(props: { selected: boolean; label: string; hint: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      className={`block w-full rounded-lg border px-4 py-3 text-left ${
        props.selected ? "border-[#E4572E] bg-[#E4572E]/10" : "border-stone-300 bg-white"
      }`}
    >
      <span className="block text-lg font-semibold text-stone-900">{props.label}</span>
      <span className="block text-sm text-stone-600">{props.hint}</span>
    </button>
  );
}

function plural(forms: { one: string; other: string }, n: number): string {
  return fill(n === 1 ? forms.one : forms.other, { n });
}

function WebsiteStatus({ summary, gaveUp }: { summary: WebsiteReadSummary | null; gaveUp: boolean }) {
  const d = t.done;
  let text: string;
  let tone: "info" | "warn" = "info";
  if (!summary || summary.state === "reading") {
    text = gaveUp ? d.websiteStillReading : d.websiteReading;
  } else if (summary.state === "blocked" || summary.state === "failed") {
    text = d.websiteFailed;
    tone = "warn";
  } else if (summary.facts === 0) {
    text = d.websiteNoFacts;
  } else {
    text = fill(d.websiteDone, { pages: plural(d.pages, summary.pages), facts: plural(d.facts, summary.facts) });
  }
  return (
    <p
      role="status"
      className={`rounded-lg border p-3 ${
        tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 bg-stone-50 text-stone-700"
      }`}
    >
      {text}
    </p>
  );
}
