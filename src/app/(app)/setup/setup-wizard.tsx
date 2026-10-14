"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogoUploader } from "@/components/brand-pickers";
import { instagramStatusLine } from "@/components/instagram/instagram-card";
import { chipClass, errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";
import { tweenSignal } from "@/lib/tween/events";
import { regionOfLocale, type CountryOption } from "@/lib/setup/countries";
import { emptyAnswers, LIKE_MAX_CHARS, MAX_LIKES, type DraftAnswers } from "@/lib/setup/draft";
import { defaultPostLanguage, type LanguageOption } from "@/lib/setup/languages";
import type { RegionOption } from "@/lib/setup/regions";
import { fieldError, GOALS, normalizeWebsiteInput, TONES } from "@/lib/setup/schema";
import type { SetupFindings } from "@/lib/setup/details";
import {
  MINUTE_PICKS,
  nextStep,
  ONLINE_CHOICES,
  pathOf,
  previousStep,
  stepsFor,
  toggleOnline,
  type SetupStep,
} from "@/lib/setup/steps";
import {
  allTimezones,
  browserTimezone,
  countryOfTimezone,
  describeTimezone,
  normalizeTimezone,
} from "@/lib/setup/timezones";
import { uspExamplesFor } from "@/lib/setup/usp-examples";
import { websiteStatusMessage } from "@/lib/setup/website-message";
import { completeSetupAction, contactSuggestionsAction, saveStepAction, setupFindingsAction } from "./actions";
import { ChoiceCard } from "./choice-card";
import { HoursEditor } from "./hours-editor";

/**
 * Setup v3 (PRD v3 D-1 to D-3, change C-01): short screens, one question each, with a progress bar.
 *
 *   Path A (online):  business -> online -> addresses -> location -> customers -> reach -> hours -> logo
 *                       -> likes -> goal -> style -> minutes -> schedule -> done
 *   Path B (not yet): the same without "addresses".
 *
 * Every screen is saved as soon as "Next" is pressed (saveStepAction), together with the screen to show next,
 * so a reload resumes where the owner left off. The website and Instagram reads start on the "addresses"
 * screen and run in the background: setup never waits for them (Req 6).
 */

const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 60_000;

const t = s.setupV2;

export interface SetupInitial {
  brandId: string | null;
  step: SetupStep;
  answers: DraftAnswers;
  logoPath: string | null;
}

interface Props {
  countries: CountryOption[];
  /** Country -> regions ("US-OR"), only for countries that have any. */
  regions: Record<string, RegionOption[]>;
  /** Country -> IANA zones. */
  zonesByCountry: Record<string, string[]>;
  languages: LanguageOption[];
  /** Where to start: the saved draft after a reload. Omitted for a new owner. */
  initial?: SetupInitial;
}

function errorText(code: string | null | undefined): string | null {
  if (!code) return null;
  const table = t.errors as Record<string, string>;
  return table[code] ?? t.errors.invalid;
}

function plural(n: number, forms: { one: string; other: string }): string {
  return fill(n === 1 ? forms.one : forms.other, { n });
}

export function SetupWizard({ countries, regions, zonesByCountry, languages, initial }: Props) {
  const [a, setA] = useState<DraftAnswers>(initial?.answers ?? emptyAnswers());
  const [step, setStep] = useState<SetupStep>(() => {
    const first = initial?.step ?? "business";
    return stepsFor(initial?.answers.online ?? []).includes(first) ? first : "online";
  });
  const [brandId, setBrandId] = useState<string | null>(initial?.brandId ?? null);
  const [logoPath, setLogoPath] = useState<string | null>(initial?.logoPath ?? null);
  const [showZones, setShowZones] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState<SetupFindings | null>(null);
  const [pollGaveUp, setPollGaveUp] = useState(false);
  const [suggested, setSuggested] = useState({ phone: false, email: false });

  // What the owner has changed by hand is never overwritten by a default or a suggestion.
  const touched = useRef({ timezone: false, language: false, phone: false, email: false });
  const browserTz = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const patch = (p: Partial<DraftAnswers>) => setA((cur) => ({ ...cur, ...p }));

  // Defaults from the browser: time zone, then country (from the zone, else the locale). Only for a fresh start.
  useEffect(() => {
    const tz = browserTimezone();
    browserTz.current = tz;
    if (initial?.answers.country) return;
    const guess = (tz && countryOfTimezone(tz, zonesByCountry)) || regionOfLocale(navigator.language);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only defaults, cannot be known on the server
    setA((cur) => ({
      ...cur,
      timezone: tz || cur.timezone,
      country: guess || cur.country,
      language: guess ? defaultPostLanguage(guess) : cur.language,
    }));
  }, [zonesByCountry, initial]);

  // Tween (M-1) greets the owner when setup opens and cheers when it is saved.
  useEffect(() => {
    tweenSignal("setup_started");
  }, []);

  // Each screen starts at the top with its heading read out.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const list = stepsFor(a.online);
  const stepIndex = Math.max(0, list.indexOf(step));
  const total = list.length;
  const path = pathOf(a.online);

  const zoneChoices = useMemo(() => {
    const zones = zonesByCountry[a.country]?.length ? zonesByCountry[a.country] : allTimezones();
    return a.timezone && !zones.includes(a.timezone) ? [a.timezone, ...zones] : zones;
  }, [zonesByCountry, a.country, a.timezone]);

  function chooseCountry(code: string) {
    const zones = zonesByCountry[code];
    patch({
      country: code,
      region: "",
      language: touched.current.language ? a.language : defaultPostLanguage(code),
      timezone:
        !touched.current.timezone && zones?.length ? (zones.includes(browserTz.current) ? browserTz.current : zones[0]) : a.timezone,
    });
  }

  // ---- moving between screens --------------------------------------------------------------

  const back = () => {
    setSaveError(null);
    setErrors({});
    setStep(previousStep(step, a.online));
  };

  /** Saves this screen (with any last change in `change`), then shows the next one. Stays put on an error. */
  async function advance(change: Partial<DraftAnswers> = {}) {
    const answers = { ...a, ...change };
    const to = nextStep(step, answers.online);
    setSaving(true);
    setSaveError(null);
    setErrors({});
    try {
      const res = await saveStepAction({ step, next: to, answers });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) setSaveError(res.message);
        return;
      }
      setA(answers);
      setBrandId(res.brandId);
      setStep(to);
    } catch {
      setSaveError(s.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setSaving(true);
    setSaveError(null);
    try {
      const url = a.online.includes("website") ? normalizeWebsiteInput(a.website) : "";
      const res = await completeSetupAction({
        business_name: a.name,
        what_sell: a.sell,
        customers: a.customers,
        country: a.country,
        region: a.region,
        city: a.city,
        timezone: a.timezone,
        goal: a.goal,
        tone: a.tone,
        post_language: a.language,
        minutes_per_post: Number(a.minutes),
        website_url: url,
        schedule_weekday: a.weekday,
        schedule_time: a.time,
      });
      if (!res.ok) {
        setSaveError(res.message);
        return;
      }
      tweenSignal("setup_done");
      setStep("done");
    } catch {
      setSaveError(s.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  // ---- Path A, contact screen: prefill from what the website read has found so far ---------------

  useEffect(() => {
    if (step !== "reach" || !a.online.includes("website")) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    async function look() {
      try {
        const res = await contactSuggestionsAction();
        if (cancelled || !res.ok) return;
        const sg = res.suggestions;
        setA((cur) => {
          const next = { ...cur };
          if (sg.phone && !touched.current.phone && cur.phone === "") next.phone = sg.phone;
          if (sg.email && !touched.current.email && cur.email === "") next.email = sg.email;
          return next;
        });
        setSuggested((cur) => ({
          phone: cur.phone || (sg.phone !== "" && !touched.current.phone),
          email: cur.email || (sg.email !== "" && !touched.current.email),
        }));
        // The read may still be running: look once more in a few seconds, but never wait for it.
        if (sg.reading && tries++ < 1) timer = setTimeout(() => void look(), 4000);
      } catch {
        // No suggestion is fine.
      }
    }
    void look();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the screen opens
  }, [step]);

  // ---- Done: what the reads have found so far, polling every 2 s for up to 60 s --------------------

  useEffect(() => {
    if (step !== "done") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    async function tick() {
      try {
        const res = await setupFindingsAction();
        if (cancelled) return;
        if (res.ok) {
          setFindings(res.findings);
          if (res.findings.finished) return;
        }
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
  }, [step]);

  // ---- per-screen checks -------------------------------------------------------------------

  const errs = {
    name: fieldError("business_name", a.name),
    sell: fieldError("what_sell", a.sell),
    customers: fieldError("customers", a.customers),
    country: fieldError("country", a.country),
    timezone: fieldError("timezone", a.timezone),
    language: fieldError("post_language", a.language),
    minutes: fieldError("minutes_per_post", a.minutes === "" ? undefined : Number(a.minutes)),
  };
  const regionList = regions[a.country] ?? [];

  // ---- screens -----------------------------------------------------------------------------

  const shell = (title: string, body: React.ReactNode, footer: React.ReactNode, stack = false) => (
    // A centred card on desktop (about 640 px wide); the plain phone page below 768 px.
    <section
      data-setup-step={step}
      data-setup-path={path}
      className="mx-auto w-full max-w-[640px] space-y-5 md:mt-4 md:rounded-2xl md:border md:border-stone-200 md:bg-white md:p-8 md:shadow-sm"
    >
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
      <div className={stack ? "flex flex-col gap-3" : "flex gap-3 md:justify-end"}>{footer}</div>
    </section>
  );

  const backButton = (
    <button type="button" className={secondaryButton} onClick={back} disabled={saving}>
      {t.back}
    </button>
  );
  const nextButton = (ok: boolean, label: string = t.next, onClick: () => void = () => void advance()) => (
    <button type="button" className={primaryButton} disabled={!ok || saving} onClick={onClick}>
      {saving ? t.saving : label}
    </button>
  );
  const skipButton = (label: string, change: Partial<DraftAnswers>) => (
    <button type="button" className={secondaryButton} disabled={saving} onClick={() => void advance(change)}>
      {label}
    </button>
  );
  const showError = (code: string | undefined) =>
    code ? (
      <p role="alert" className={errorClass}>
        {errorText(code)}
      </p>
    ) : null;

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
            value={a.name}
            onChange={(e) => patch({ name: e.target.value })}
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
            value={a.sell}
            onChange={(e) => patch({ sell: e.target.value })}
            placeholder={t.business.sellPlaceholder}
            maxLength={200}
          />
        </div>
      </div>,
      nextButton(!errs.name && !errs.sell),
    );
  }

  if (step === "online") {
    return shell(
      t.online.title,
      <div className="space-y-3">
        <p className={hintClass}>{t.online.hint}</p>
        <div role="group" aria-label={t.online.groupLabel} className="space-y-3">
          {ONLINE_CHOICES.map((c) => (
            <ChoiceCard
              key={c}
              kind="checkbox"
              selected={a.online.includes(c)}
              label={t.online.options[c].label}
              hint={t.online.options[c].hint}
              onSelect={() => patch({ online: toggleOnline(a.online, c) })}
            />
          ))}
        </div>
      </div>,
      <>
        {backButton}
        {skipButton(t.online.skip, { online: [] })}
        {nextButton(a.online.length > 0)}
      </>,
    );
  }

  if (step === "addresses") {
    const wantsSite = a.online.includes("website");
    const wantsIg = a.online.includes("instagram");
    const wantsYt = a.online.includes("youtube");
    const siteBad = wantsSite && a.website.trim() !== "" && fieldError("website_url", a.website) !== null;
    const igBad = wantsIg && a.instagram.trim() !== "" && normalizeInstagramHandle(a.instagram) === null;
    const ytBad = wantsYt && a.youtube.trim().length > 300;
    const anyFilled =
      (wantsSite && a.website.trim() !== "") || (wantsIg && a.instagram.trim() !== "") || (wantsYt && a.youtube.trim() !== "");
    return shell(
      t.addresses.title,
      <div className="space-y-5">
        <p className={hintClass}>{t.addresses.hint}</p>
        {wantsSite && (
          <div>
            <label htmlFor="sv2-website" className={labelClass}>
              {t.addresses.websiteLabel}
            </label>
            <p id="sv2-website-hint" className={hintClass}>
              {t.addresses.websiteHint}
            </p>
            <input
              id="sv2-website"
              aria-describedby="sv2-website-hint"
              className={inputClass}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={a.website}
              onChange={(e) => patch({ website: e.target.value })}
              placeholder={s.setupV2.website.placeholder}
              maxLength={2000}
            />
            {(siteBad || errors.website) && (
              <p role="alert" className={errorClass}>
                {errorText(errors.website ?? "invalid_url")}
              </p>
            )}
          </div>
        )}
        {wantsIg && (
          <div>
            <label htmlFor="sv2-instagram" className={labelClass}>
              {t.addresses.instagramLabel}
            </label>
            <p id="sv2-instagram-hint" className={hintClass}>
              {t.addresses.instagramHint}
            </p>
            <input
              id="sv2-instagram"
              aria-describedby="sv2-instagram-hint"
              className={inputClass}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={a.instagram}
              onChange={(e) => patch({ instagram: e.target.value })}
              placeholder={s.instagram.placeholder}
              maxLength={300}
            />
            {(igBad || errors.instagram) && (
              <p role="alert" className={errorClass}>
                {s.instagram.invalidHandle}
              </p>
            )}
          </div>
        )}
        {wantsYt && (
          <div>
            <label htmlFor="sv2-youtube" className={labelClass}>
              {t.addresses.youtubeLabel}
            </label>
            <p id="sv2-youtube-hint" className={hintClass}>
              {t.addresses.youtubeHint}
            </p>
            <input
              id="sv2-youtube"
              aria-describedby="sv2-youtube-hint"
              className={inputClass}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={a.youtube}
              onChange={(e) => patch({ youtube: e.target.value })}
              placeholder={t.addresses.youtubePlaceholder}
              maxLength={300}
            />
            {(ytBad || errors.youtube) && (
              <p role="alert" className={errorClass}>
                {errorText(errors.youtube ?? "invalid_handle")}
              </p>
            )}
          </div>
        )}
        <p role="status" className="rounded-lg bg-stone-50 p-3 text-stone-700">
          {t.addresses.reading}
        </p>
      </div>,
      <>
        {backButton}
        {skipButton(t.addresses.skip, { website: "", instagram: "", youtube: "" })}
        {nextButton(anyFilled && !siteBad && !igBad && !ytBad)}
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
            value={a.country}
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
          {showError(errors.country)}
        </div>
        {regionList.length > 0 && (
          <div>
            <label htmlFor="sv2-region" className={labelClass}>
              {t.location.regionLabel}
            </label>
            <p className={hintClass}>{t.location.regionHint}</p>
            <select id="sv2-region" className={inputClass} value={a.region} onChange={(e) => patch({ region: e.target.value })}>
              <option value="">{t.location.regionPlaceholder}</option>
              {regionList.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
            {showError(errors.region)}
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
            value={a.city}
            onChange={(e) => patch({ city: e.target.value })}
            placeholder={t.location.cityPlaceholder}
            maxLength={100}
            autoComplete="address-level2"
          />
        </div>
        <div>
          {a.timezone && (
            <p className="text-stone-700">{fill(t.location.timezoneIs, { zone: describeTimezone(a.timezone) })}</p>
          )}
          {showZones ? (
            <div className="mt-2">
              <label htmlFor="sv2-tz" className={labelClass}>
                {t.location.timezoneLabel}
              </label>
              <select
                id="sv2-tz"
                className={inputClass}
                value={a.timezone}
                onChange={(e) => {
                  touched.current.timezone = true;
                  patch({ timezone: normalizeTimezone(e.target.value) });
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
          value={a.customers}
          onChange={(e) => patch({ customers: e.target.value })}
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

  if (step === "reach") {
    return shell(
      t.reach.title,
      <div className="space-y-5">
        <p className={hintClass}>{t.reach.hint}</p>
        <div>
          <label htmlFor="sv2-phone" className={labelClass}>
            {t.reach.phoneLabel}
          </label>
          <p id="sv2-phone-hint" className={hintClass}>
            {t.reach.phoneHint}
          </p>
          <input
            id="sv2-phone"
            aria-describedby="sv2-phone-hint"
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={a.phone}
            onChange={(e) => {
              touched.current.phone = true;
              setSuggested((cur) => ({ ...cur, phone: false }));
              patch({ phone: e.target.value });
            }}
            placeholder={t.reach.phonePlaceholder}
            maxLength={40}
          />
          {suggested.phone && a.phone !== "" && <p className="mt-1 text-sm text-stone-600">{t.reach.fromWebsite}</p>}
          {showError(errors.phone)}
          <label className="mt-2 flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={a.sameWhatsapp}
              onChange={(e) => patch({ sameWhatsapp: e.target.checked })}
            />
            <span>{t.reach.sameWhatsapp}</span>
          </label>
        </div>
        {!a.sameWhatsapp && (
          <div>
            <label htmlFor="sv2-whatsapp" className={labelClass}>
              {t.reach.whatsappLabel}
            </label>
            <p id="sv2-whatsapp-hint" className={hintClass}>
              {t.reach.whatsappHint}
            </p>
            <input
              id="sv2-whatsapp"
              aria-describedby="sv2-whatsapp-hint"
              className={inputClass}
              type="tel"
              inputMode="tel"
              value={a.whatsapp}
              onChange={(e) => patch({ whatsapp: e.target.value })}
              placeholder={t.reach.phonePlaceholder}
              maxLength={40}
            />
            {showError(errors.whatsapp)}
          </div>
        )}
        <div>
          <label htmlFor="sv2-email" className={labelClass}>
            {t.reach.emailLabel}
          </label>
          <input
            id="sv2-email"
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={a.email}
            onChange={(e) => {
              touched.current.email = true;
              setSuggested((cur) => ({ ...cur, email: false }));
              patch({ email: e.target.value });
            }}
            placeholder={t.reach.emailPlaceholder}
            maxLength={254}
          />
          {suggested.email && a.email !== "" && <p className="mt-1 text-sm text-stone-600">{t.reach.fromWebsite}</p>}
          {showError(errors.email)}
        </div>
      </div>,
      <>
        {backButton}
        {skipButton(t.reach.skip, { phone: "", whatsapp: "", sameWhatsapp: false, email: "" })}
        {nextButton(true)}
      </>,
      true,
    );
  }

  if (step === "hours") {
    const modes = ["days", "always", "appointment"] as const;
    return shell(
      t.hours.title,
      <div className="space-y-4">
        <p className={hintClass}>{t.hours.hint}</p>
        <div role="radiogroup" aria-label={t.hours.modesLabel} className="space-y-3">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={a.hoursMode === m}
              onClick={() => patch({ hoursMode: m })}
              className={`block w-full rounded-lg border px-4 py-3 text-left text-lg font-semibold ${
                a.hoursMode === m ? "border-[#E4572E] bg-[#E4572E]/10" : "border-stone-300 bg-white"
              }`}
            >
              {t.hours.modes[m]}
            </button>
          ))}
        </div>
        {a.hoursMode === "days" && <HoursEditor days={a.hours} onChange={(hours) => patch({ hours })} />}
        {showError(errors.hours)}
      </div>,
      <>
        {backButton}
        {skipButton(t.hours.skip, { hoursMode: "" })}
        {nextButton(a.hoursMode !== "")}
      </>,
      true,
    );
  }

  if (step === "logo") {
    return shell(
      t.logo.title,
      <div className="space-y-3">
        <p className={hintClass}>{t.logo.hint}</p>
        {brandId ? (
          <LogoUploader brandId={brandId} logoPath={logoPath} onChange={(next) => setLogoPath(next)} />
        ) : null}
      </div>,
      <>
        {backButton}
        {logoPath ? nextButton(true, t.logo.next) : skipButton(t.logo.skip, {})}
      </>,
      true,
    );
  }

  if (step === "likes") {
    const lines = Array.from({ length: MAX_LIKES }, (_, i) => a.likes[i] ?? "");
    const filled = lines.filter((l) => l.trim() !== "");
    const examples = uspExamplesFor(a.sell);
    const setLine = (i: number, value: string) => {
      const next = [...lines];
      next[i] = value;
      patch({ likes: next });
    };
    const addExample = (text: string) => {
      const at = lines.findIndex((l) => l.trim() === "");
      if (at >= 0) setLine(at, text);
    };
    return shell(
      t.likes.title,
      <div className="space-y-4">
        <p className={hintClass}>{t.likes.hint}</p>
        {lines.map((line, i) => (
          <div key={i}>
            <label htmlFor={`sv2-like-${i}`} className={labelClass}>
              {fill(t.likes.lineLabel, { n: i + 1 })}
            </label>
            <input
              id={`sv2-like-${i}`}
              className={inputClass}
              value={line}
              maxLength={LIKE_MAX_CHARS}
              onChange={(e) => setLine(i, e.target.value)}
              placeholder={t.likes.linePlaceholder}
            />
          </div>
        ))}
        {showError(errors.likes)}
        <div>
          <p className={hintClass}>{t.likes.examplesTitle}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.likes.examplesTitle}>
            {examples.map((ex) => {
              const used = lines.some((l) => l.trim().toLowerCase() === ex.toLowerCase());
              return (
                <button
                  key={ex}
                  type="button"
                  className={chipClass(used)}
                  aria-pressed={used}
                  disabled={used || filled.length >= MAX_LIKES}
                  onClick={() => addExample(ex)}
                >
                  {ex}
                </button>
              );
            })}
          </div>
        </div>
      </div>,
      <>
        {backButton}
        {skipButton(t.likes.skip, { likes: [] })}
        {nextButton(true)}
      </>,
      true,
    );
  }

  if (step === "goal") {
    return shell(
      t.goal.title,
      <div role="radiogroup" aria-label={t.goal.title} className="space-y-3">
        {GOALS.map((g) => (
          <ChoiceCard
            key={g}
            selected={a.goal === g}
            label={t.goal.options[g].label}
            hint={t.goal.options[g].hint}
            onSelect={() => patch({ goal: g })}
          />
        ))}
      </div>,
      <>
        {backButton}
        {nextButton(a.goal !== "")}
      </>,
    );
  }

  if (step === "style") {
    return shell(
      t.style.title,
      <div className="space-y-5">
        <div className="space-y-3">
          <div role="radiogroup" aria-label={t.tone.title} className="space-y-3">
            {TONES.map((k) => (
              <ChoiceCard
                key={k}
                selected={a.tone === k}
                label={t.tone.options[k].label}
                hint={t.tone.options[k].hint}
                onSelect={() => patch({ tone: k })}
              />
            ))}
          </div>
          {a.tone === "like_past_posts" && (
            <p role="status" className="rounded-lg bg-stone-50 p-3 text-stone-700">
              {t.tone.pastPostsNote}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="sv2-language" className={labelClass}>
            {t.language.title}
          </label>
          <p className={hintClass}>{t.language.hint}</p>
          <select
            id="sv2-language"
            className={inputClass}
            value={a.language}
            onChange={(e) => {
              touched.current.language = true;
              patch({ language: e.target.value });
            }}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>,
      <>
        {backButton}
        {nextButton(a.tone !== "" && !errs.language)}
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
            value={a.minutes}
            onChange={(e) => patch({ minutes: e.target.value })}
          />
          {a.minutes !== "" && errs.minutes && (
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
              aria-pressed={a.minutes === String(m)}
              onClick={() => patch({ minutes: String(m) })}
              className={chipClass(a.minutes === String(m))}
            >
              {fill(t.minutes.minutesUnit, { n: m })}
            </button>
          ))}
        </div>
      </div>,
      <>
        {backButton}
        {nextButton(a.minutes !== "" && !errs.minutes)}
      </>,
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
            value={a.weekday}
            onChange={(e) => patch({ weekday: Number(e.target.value) })}
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
            value={a.time}
            onChange={(e) => patch({ time: e.target.value })}
          />
        </div>
        <p className={hintClass}>{fill(t.schedule.zoneNote, { zone: describeTimezone(a.timezone || "UTC") })}</p>
      </div>,
      <>
        {backButton}
        <button
          type="button"
          className={primaryButton}
          disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) || saving}
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
      <p className="text-stone-700">{fill(t.done.body, { day: t.schedule.weekdays[a.weekday - 1], time: a.time })}</p>
      <p className="text-stone-700">{t.done.queueNote}</p>
      {path === "A" && <Findings findings={findings} gaveUp={pollGaveUp} online={a.online} />}
    </div>,
    <Link href="/brand" className={`${primaryButton} inline-block text-center`}>
      {t.done.goToBrand}
    </Link>,
  );
}

function Status({ text, warn = false }: { text: string; warn?: boolean }) {
  return (
    <p
      role="status"
      className={`rounded-lg border p-3 ${
        warn ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 bg-stone-50 text-stone-700"
      }`}
    >
      {text}
    </p>
  );
}

/** What the website read and the Instagram import have found so far, with links to review it on the Brand page. Never blocks. */
function Findings({ findings, gaveUp, online }: { findings: SetupFindings | null; gaveUp: boolean; online: DraftAnswers["online"] }) {
  const d = t.done;
  if (!findings) return <Status text={online.includes("website") ? d.websiteReading : d.instagramReading} />;
  const site = findings.website ? websiteStatusMessage(findings.website, gaveUp) : null;
  const ig = findings.instagram;
  const igLine = ig
    ? ig.status === null
      ? gaveUp
        ? null
        : d.instagramReading
      : instagramStatusLine({ handle: ig.handle, status: ig.status, importedPosts: ig.importedPosts })
    : null;
  const links: Array<[string, string]> = [];
  if (findings.website && findings.website.facts > 0) links.push(["/brand#facts", d.reviewFacts]);
  if (findings.contactsFound > 0) links.push(["/brand#contacts", d.reviewContacts]);
  if (findings.uspsSuggested > 0) links.push(["/brand#usps", d.reviewUsps]);
  if (ig && ig.importedPosts > 0) links.push(["/brand#uploads", d.reviewInstagram]);
  return (
    <div className="space-y-3" data-testid="setup-findings">
      <h2 className="text-lg font-semibold">{d.findingsTitle}</h2>
      {site && <Status text={site.text} warn={site.tone === "warn"} />}
      {igLine && <Status text={igLine} />}
      {findings.contactsFound > 0 && <Status text={plural(findings.contactsFound, d.contactsFound)} />}
      {findings.uspsSuggested > 0 && <Status text={plural(findings.uspsSuggested, d.uspsSuggested)} />}
      {links.length > 0 && (
        <p className="text-stone-700">
          {d.review}:{" "}
          {links.map(([href, label], i) => (
            <span key={href}>
              {i > 0 && " · "}
              <Link href={href} className="underline">
                {label}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
