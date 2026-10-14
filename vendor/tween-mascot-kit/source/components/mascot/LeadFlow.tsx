"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MascotContent, SystemCopy } from "@/lib/content-schema";
import { MAKE_OPTIONS, ROLE_OPTIONS, type LeadFormId } from "@/lib/lead-fields";
import { LEAD_STEPS, buildPayload, emptyAnswers, formIdFor, interpretResponse, validateStep, type LeadAnswers, type LeadStep } from "@/lib/mascot/lead";
import { KEYS, remove, write } from "@/lib/mascot/storage";
import { deviceClass, detectInAppBrowser, getLandingContext, getUtm, getVariantId, setLeadType, track } from "@/lib/tracking";
import { Txt } from "../ui/Txt";
import { Chips } from "./Chips";
import type { Entry } from "./Transcript";

export type LeadCopy = MascotContent["lead"];
export type FormCopy = SystemCopy["form"];

type Status = "idle" | "sending" | "done" | "failed";
type FlowState = { active: boolean; step: number; answers: LeadAnswers; error: string | null; status: Status; startedAt: number; first: string };
const initial: FlowState = { active: false, step: 0, answers: emptyAnswers, error: null, status: "idle", startedAt: 0, first: "" };

export type Flow = ReturnType<typeof useLeadFlow>;

/**
 * The chat lead flow's state. It asks the form's own questions one at a time, validates each answer with the form's
 * validators and copy, and posts to the existing /api/lead endpoint with the same honeypot and time-trap fields.
 */
export function useLeadFlow(o: { pathname: string; copy: LeadCopy; form: FormCopy; onEntry: (e: Entry) => void; onSuccess: () => void; onOpenForm: () => void }) {
  const [s, setS] = useState<FlowState>(initial);
  const formId: LeadFormId = formIdFor(o.pathname);
  const messages = undefined;

  const prompt = (step: LeadStep) => o.copy[step].prompt;

  const start = () => {
    setS({ ...initial, active: true, startedAt: Date.now() });
    o.onEntry({ who: "tween", text: prompt("name") });
    track("tween_lead_start", { form_id: formId });
  };
  const cancel = () => setS(initial);
  const set = <K extends keyof LeadAnswers>(k: K, v: LeadAnswers[K]) => setS((p) => ({ ...p, answers: { ...p.answers, [k]: v }, error: null }));

  const advance = (answers: LeadAnswers) => {
    const step = LEAD_STEPS[s.step]!;
    const err = validateStep(step, answers, messages);
    if (err) {
      setS((p) => ({ ...p, error: err }));
      return;
    }
    o.onEntry({ who: "you", text: o.copy.answerGiven });
    const next = LEAD_STEPS[s.step + 1];
    if (next) o.onEntry({ who: "tween", text: prompt(next) });
    setS((p) => ({ ...p, answers, step: p.step + 1, error: null, first: step === "name" ? answers.name.trim().split(/\s+/)[0] ?? "" : p.first }));
  };
  const pick = (k: "make" | "role", v: string) => advance({ ...s.answers, [k]: v });

  const submit = async () => {
    if (s.status === "sending") return;
    const err = validateStep("consent", s.answers, messages);
    if (err) return setS((p) => ({ ...p, error: err }));
    setS((p) => ({ ...p, status: "sending", error: null }));
    const land = getLandingContext();
    const body = buildPayload(s.answers, {
      startedAt: s.startedAt,
      hp: (document.querySelector<HTMLInputElement>('[data-tween="hp"]')?.value ?? ""),
      formId,
      extra: { ...getUtm(), landing_path: land.landing_path, referrer: land.referrer, variant_id: getVariantId(), in_app_browser: detectInAppBrowser(), device_class: deviceClass() },
    });
    try {
      const res = await fetch("/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; errors?: Record<string, string>; qualification?: { leadType: "saas" | "startup" | "agency" | "other"; segment: string; score: number } } | null;
      const out = interpretResponse({ ok: res.ok, status: res.status, json }, o.form.errors.generic);
      if (out.kind === "ok") {
        if (json?.qualification) setLeadType(json.qualification.leadType);
        track("tween_lead_submit", { form_id: formId });
        track("form_submit", { form_id: formId, source: "tween", role: s.answers.role });
        o.onEntry({ who: "tween", text: o.form.success.heading.replace(/,?\s*\{name\}/, "") });
        setS((p) => ({ ...p, status: "done" }));
        o.onSuccess();
      } else if (out.kind === "field") {
        track("error_lead_api", { status: res.status });
        setS((p) => ({ ...p, status: "idle", step: LEAD_STEPS.indexOf(out.step), error: out.message }));
      } else {
        track("error_lead_api", { status: res.status });
        o.onEntry({ who: "tween", text: out.message });
        setS((p) => ({ ...p, status: "failed", error: out.message }));
      }
    } catch {
      track("error_lead_api", { status: 0 });
      setS((p) => ({ ...p, status: "failed", error: o.form.errors.generic }));
    }
  };

  const openForm = () => {
    const a = s.answers;
    write("session", KEYS.prefill, JSON.stringify({ name: a.name, email: a.email, website: a.website, make: a.make, role: a.role }));
    setS(initial);
    o.onOpenForm();
  };

  // A finished or abandoned flow leaves nothing behind.
  useEffect(() => {
    if (s.status === "done") remove("session", KEYS.prefill);
  }, [s.status]);

  return { s, start, cancel, set, advance: () => advance(s.answers), pick, submit, openForm, retry: () => setS((p) => ({ ...p, status: "idle", error: null })) };
}

const FIELD: Record<"name" | "email" | "website", { type: string; auto: string; inputMode?: "email" | "url" }> = {
  name: { type: "text", auto: "name" },
  email: { type: "email", auto: "email", inputMode: "email" },
  website: { type: "text", auto: "url", inputMode: "url" },
};

export function LeadFlow({ flow, copy, form, sla, email }: { flow: Flow; copy: LeadCopy; form: FormCopy; sla: string; email: string }) {
  const { s } = flow;
  const step = LEAD_STEPS[s.step];
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [s.step, s.status]);

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    flow.advance();
  };

  if (s.status === "done") {
    return (
      <div data-tween="lead-done" className="tw-lead">
        <p className="tw-lead-prompt">
          <Txt>{form.success.heading.replace("{name}", s.first)}</Txt>
        </p>
        <p>
          <Txt>{form.success.body.replace("{sla}", sla)}</Txt>
        </p>
        <Link href="/how-it-works" className="tw-link">
          {form.success.seeHow}
        </Link>
      </div>
    );
  }
  if (s.status === "failed") {
    return (
      <div data-tween="lead-failed" className="tw-lead">
        <p role="alert" className="tw-error">
          {s.error}
        </p>
        <p>
          <Txt>{form.success.emailFallback.replace("{{email}}", email)}</Txt>
        </p>
        <button type="button" className="tw-chip" onClick={flow.retry}>
          {copy.retry}
        </button>
      </div>
    );
  }

  const label = step && step in FIELD ? form.labels[step as "name" | "email" | "website"] : "";
  return (
    <div data-tween="lead" role="group" aria-label={copy.formLabel} className="tw-lead">
      {step && (
        <>
          <p className="tw-lead-step">{copy.stepLabel.replace("{n}", String(s.step + 1)).replace("{total}", String(LEAD_STEPS.length))}</p>
          <p className="tw-lead-prompt">{copy[step].prompt}</p>
        </>
      )}
      {step && (step === "name" || step === "email" || step === "website") && (
        <form onSubmit={submitText} noValidate>
          <label htmlFor="tween-lead-input" className="tw-label">
            {label}
          </label>
          <input
            key={step}
            ref={inputRef}
            id="tween-lead-input"
            data-tween="lead-input"
            name={step}
            type={FIELD[step].type}
            inputMode={FIELD[step].inputMode}
            autoComplete={FIELD[step].auto}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!s.error}
            aria-describedby={s.error ? "tween-lead-error" : undefined}
            placeholder={form.placeholders[step]}
            value={s.answers[step]}
            onChange={(e) => flow.set(step, e.target.value)}
            className="tw-input"
          />
          {s.error && (
            <p id="tween-lead-error" role="alert" className="tw-error">
              {s.error}
            </p>
          )}
          <button type="submit" className="tw-primary" data-tween="lead-next">
            {copy.next}
          </button>
        </form>
      )}
      {step === "make" && (
        <>
          <Chips ready chips={MAKE_OPTIONS.map((o) => ({ label: o, value: o }))} label={form.labels.make} onPick={(c) => flow.pick("make", c.value)} />
          {s.error && (
            <p role="alert" className="tw-error">
              {s.error}
            </p>
          )}
        </>
      )}
      {step === "role" && (
        <>
          <Chips ready chips={ROLE_OPTIONS.map((o) => ({ label: o, value: o }))} label={form.labels.role} onPick={(c) => flow.pick("role", c.value)} />
          {s.error && (
            <p role="alert" className="tw-error">
              {s.error}
            </p>
          )}
        </>
      )}
      {step === "consent" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void flow.submit();
          }}
          noValidate
        >
          <label className="tw-consent">
            <input
              ref={inputRef}
              type="checkbox"
              data-tween="lead-consent"
              checked={s.answers.consent}
              onChange={(e) => flow.set("consent", e.target.checked)}
              aria-invalid={!!s.error}
              aria-describedby={s.error ? "tween-lead-error" : undefined}
            />
            <span>
              <Txt>{form.consent}</Txt>{" "}
              <Link href="/privacy" className="tw-link">
                {form.consentLink}
              </Link>
            </span>
          </label>
          {s.error && (
            <p id="tween-lead-error" role="alert" className="tw-error">
              {s.error}
            </p>
          )}
          <button type="submit" disabled={s.status === "sending"} className="tw-primary" data-tween="lead-send">
            {s.status === "sending" ? copy.sending : copy.send}
          </button>
        </form>
      )}
      {/* honeypot: invisible to people and assistive technology, tempting to bots */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          {copy.honeypotLabel}
          <input type="text" data-tween="hp" name="hp" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="tw-lead-foot">
        <button type="button" className="tw-link" data-tween="open-form" onClick={flow.openForm}>
          {copy.openForm}
        </button>
        <button type="button" className="tw-link" data-tween="lead-cancel" onClick={flow.cancel}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
