"use client";

import { useMemo, useState, useTransition } from "react";
import { saveSettingsAction } from "@/app/(app)/brand/actions";
import { errorClass, hintClass, inputClass, labelClass, primaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { formatDate } from "@/lib/memory/messages";
import { isRegulatedBrand, parseSettings, REGULATED_CHOICES, settingsFromForm, type RegulatedChoice, type SettingsFieldErrors } from "@/lib/memory/schema";
import type { SettingsForm } from "@/lib/memory/settings";
import type { CountryOption } from "@/lib/setup/countries";
import type { LanguageOption } from "@/lib/setup/languages";
import type { RegionOption } from "@/lib/setup/regions";
import { GOALS, TONES } from "@/lib/setup/schema";
import { allTimezones, describeTimezone, normalizeTimezone } from "@/lib/setup/timezones";

const t = s.brandV2.settings;
const errorText = s.setupV2.errors as Record<string, string>;

export interface SettingsPanelProps {
  brandId: string;
  initial: SettingsForm;
  /** What we detect from "what you sell": none, health, finance, alcohol or legal. */
  detected: string;
  email: { pausedUntil: string | null; unsubscribedAt: string | null };
  websiteUrl: string | null;
  countries: CountryOption[];
  regions: Record<string, RegionOption[]>;
  zonesByCountry: Record<string, string[]>;
  languages: LanguageOption[];
}

/** Email status, read-only for now (pause and unsubscribe are built with the email task). */
export function EmailStatus({ email }: { email: SettingsPanelProps["email"] }) {
  const text = email.unsubscribedAt
    ? fill(t.emailUnsubscribed, { date: formatDate(email.unsubscribedAt) })
    : email.pausedUntil
      ? fill(t.emailPaused, { date: formatDate(email.pausedUntil) })
      : t.emailOn;
  return (
    <div className="space-y-1 rounded-xl border border-stone-200 p-3">
      <p className="font-medium">{t.emailTitle}</p>
      <p>{text}</p>
      <p className="text-sm text-stone-500">{t.emailNote}</p>
    </div>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { brandId, countries, regions, zonesByCountry, languages } = props;
  const [form, setForm] = useState<SettingsForm>(props.initial);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setMessage(null);
  }

  const regionList = regions[form.country] ?? [];
  const zoneChoices = useMemo(() => {
    const list = zonesByCountry[form.country]?.length ? zonesByCountry[form.country] : allTimezones();
    return form.timezone && !list.includes(form.timezone) ? [form.timezone, ...list] : list;
  }, [zonesByCountry, form.country, form.timezone]);

  function chooseCountry(code: string) {
    setForm((f) => {
      const zones = zonesByCountry[code];
      const timezone = zones?.length && !zones.includes(f.timezone) ? zones[0] : f.timezone;
      return { ...f, country: code, region: "", timezone };
    });
    setMessage(null);
  }

  function save() {
    const parsed = parseSettings(settingsFromForm(form));
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      setMessage({ ok: false, text: s.brandV2.saveFailed });
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const r = await saveSettingsAction(brandId, form);
      if (r.ok) setMessage({ ok: true, text: s.brandV2.saved });
      else {
        setErrors((r.fieldErrors ?? {}) as SettingsFieldErrors);
        setMessage({ ok: false, text: r.message });
      }
    });
  }

  const err = (key: keyof SettingsForm) =>
    errors[key as keyof SettingsFieldErrors] ? (
      <p role="alert" className={errorClass}>
        {errorText[errors[key as keyof SettingsFieldErrors]!] ?? errorText.invalid}
      </p>
    ) : null;

  const detectedLabel = t.regulatedGroups[props.detected as keyof typeof t.regulatedGroups] ?? props.detected;
  const detected = fill(t.regulatedDetected, { group: detectedLabel });
  const regulated = isRegulatedBrand((form.regulated || null) as RegulatedChoice | null, props.detected);
  const row = "space-y-1";

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      <div className={row}>
        <label htmlFor="st-name" className={labelClass}>
          {t.businessName}
        </label>
        <input id="st-name" className={inputClass} value={form.business_name} maxLength={100} onChange={(e) => set("business_name", e.target.value)} />
        {err("business_name")}
      </div>

      <div className={row}>
        <label htmlFor="st-sell" className={labelClass}>
          {t.whatSell}
        </label>
        <p className={hintClass}>{t.whatSellHint}</p>
        <input id="st-sell" className={inputClass} value={form.what_sell} maxLength={200} onChange={(e) => set("what_sell", e.target.value)} />
        {err("what_sell")}
      </div>

      <div className={row}>
        <label htmlFor="st-customers" className={labelClass}>
          {t.customers}
        </label>
        <input id="st-customers" className={inputClass} value={form.customers} maxLength={200} onChange={(e) => set("customers", e.target.value)} />
        {err("customers")}
      </div>

      <div className={row}>
        <label htmlFor="st-country" className={labelClass}>
          {t.country}
        </label>
        <select id="st-country" className={inputClass} value={form.country} onChange={(e) => chooseCountry(e.target.value)} autoComplete="country">
          <option value="">{t.choose}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {err("country")}
      </div>

      {regionList.length > 0 && (
        <div className={row}>
          <label htmlFor="st-region" className={labelClass}>
            {t.region}
          </label>
          <select id="st-region" className={inputClass} value={form.region} onChange={(e) => set("region", e.target.value)}>
            <option value="">{s.setupV2.location.regionPlaceholder}</option>
            {regionList.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          {err("region")}
        </div>
      )}

      <div className={row}>
        <label htmlFor="st-city" className={labelClass}>
          {t.city}
        </label>
        <input id="st-city" className={inputClass} value={form.city} maxLength={100} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
        {err("city")}
      </div>

      <div className={row}>
        <label htmlFor="st-tz" className={labelClass}>
          {t.timezone}
        </label>
        <select id="st-tz" className={inputClass} value={form.timezone} onChange={(e) => set("timezone", normalizeTimezone(e.target.value))}>
          {zoneChoices.map((z) => (
            <option key={z} value={z}>
              {describeTimezone(z)}
            </option>
          ))}
        </select>
        {err("timezone")}
      </div>

      <div className={row}>
        <label htmlFor="st-goal" className={labelClass}>
          {t.goal}
        </label>
        <select id="st-goal" className={inputClass} value={form.goal} onChange={(e) => set("goal", e.target.value)}>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {s.setupV2.goal.options[g].label}
            </option>
          ))}
        </select>
        {err("goal")}
      </div>

      <div className={row}>
        <label htmlFor="st-tone" className={labelClass}>
          {t.tone}
        </label>
        <select id="st-tone" className={inputClass} value={form.tone} onChange={(e) => set("tone", e.target.value)}>
          {!(TONES as readonly string[]).includes(form.tone) && <option value="">{t.choose}</option>}
          {TONES.map((k) => (
            <option key={k} value={k}>
              {s.setupV2.tone.options[k].label}
            </option>
          ))}
        </select>
        {err("tone")}
      </div>

      <div className={row}>
        <label htmlFor="st-lang" className={labelClass}>
          {t.postLanguage}
        </label>
        <select id="st-lang" className={inputClass} value={form.post_language} onChange={(e) => set("post_language", e.target.value)}>
          {!languages.some((l) => l.code === form.post_language) && <option value={form.post_language}>{form.post_language}</option>}
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        {err("post_language")}
      </div>

      <div className={row}>
        <label htmlFor="st-minutes" className={labelClass}>
          {t.minutes}
        </label>
        <input
          id="st-minutes"
          className={inputClass}
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          value={form.minutes_per_post}
          onChange={(e) => set("minutes_per_post", e.target.value)}
        />
        {err("minutes_per_post")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={row}>
          <label htmlFor="st-day" className={labelClass}>
            {t.weekday}
          </label>
          <select id="st-day" className={inputClass} value={form.schedule_weekday} onChange={(e) => set("schedule_weekday", Number(e.target.value))}>
            {s.setupV2.schedule.weekdays.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
          {err("schedule_weekday")}
        </div>
        <div className={row}>
          <label htmlFor="st-time" className={labelClass}>
            {t.time}
          </label>
          <input id="st-time" className={inputClass} type="time" value={form.schedule_time} onChange={(e) => set("schedule_time", e.target.value)} />
          {err("schedule_time")}
        </div>
      </div>
      <p className="-mt-2 text-sm text-stone-500">{t.zoneNote}</p>

      <div className={row}>
        <label htmlFor="st-link" className={labelClass}>
          {t.linkDestination}
        </label>
        <p className={hintClass}>{t.linkHint}</p>
        <input
          id="st-link"
          className={inputClass}
          inputMode="url"
          value={form.link_destination}
          maxLength={2000}
          placeholder={props.websiteUrl ?? t.linkPlaceholder}
          onChange={(e) => set("link_destination", e.target.value)}
        />
        {err("link_destination")}
      </div>

      <div className={row}>
        <label htmlFor="st-regulated" className={labelClass}>
          {t.regulatedTitle}
        </label>
        <p className={hintClass}>{t.regulatedHint}</p>
        <p className="font-medium" data-detected>
          {detected}
        </p>
        <select id="st-regulated" className={inputClass} value={form.regulated} onChange={(e) => set("regulated", e.target.value as SettingsForm["regulated"])}>
          <option value="">{`${t.regulatedAutomatic} (${detected})`}</option>
          {REGULATED_CHOICES.map((c) => (
            <option key={c} value={c}>
              {t.regulatedGroups[c]}
            </option>
          ))}
        </select>
        {err("regulated")}
        {regulated && (
          <p role="note" data-regulated-reminder className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-amber-300">
            {t.regulatedReminder}
          </p>
        )}
      </div>

      <EmailStatus email={props.email} />

      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? s.brandV2.saving : t.save}
      </button>
      <div role="status" aria-live="polite">
        {message && <p className={message.ok ? "text-emerald-800" : errorClass}>{message.text}</p>}
      </div>
    </form>
  );
}
