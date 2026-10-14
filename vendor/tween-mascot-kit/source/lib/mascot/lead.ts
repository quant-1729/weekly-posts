/**
 * The chat lead flow's logic: steps, validation with the form's own rules and copy, and the request body for the
 * existing /api/lead endpoint (same fields as the form, same honeypot and time-trap fields).
 */
import { LEAD_ERROR_MESSAGES, ROLE_OPTIONS, validateLeadFields, type ClientErrorMessages, type LeadFormId } from "@/lib/lead-fields";

export const LEAD_STEPS = ["name", "email", "website", "make", "role", "consent"] as const;
export type LeadStep = (typeof LEAD_STEPS)[number];

export type LeadAnswers = { name: string; email: string; website: string; make: string; role: string; consent: boolean };
export const emptyAnswers: LeadAnswers = { name: "", email: "", website: "", make: "", role: "", consent: false };

/** Validate one step with the real validators (the same function the form runs), returning the form's error copy or null. */
export function validateStep(step: LeadStep, a: LeadAnswers, messages: ClientErrorMessages = LEAD_ERROR_MESSAGES): string | null {
  const base = { name: "x", email: "a@b.co", website: "b.co", make: ["x"], role: ROLE_OPTIONS[0] as string, consent: true };
  const probe = { ...base, [step]: step === "make" ? (a.make ? [a.make] : []) : a[step] };
  return validateLeadFields(probe, messages)[step] ?? null;
}

export function formIdFor(pathname: string): LeadFormId {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/for/agencies")) return "agencies";
  if (pathname.startsWith("/for/startups")) return "startups";
  return "contact";
}

export type LeadPayloadContext = {
  startedAt: number;
  hp: string;
  formId: LeadFormId;
  extra: Record<string, unknown>;
};

/** The body sent to /api/lead. `consent` is only ever true after the visitor ticked the box. */
export function buildPayload(a: LeadAnswers, c: LeadPayloadContext): Record<string, unknown> {
  return {
    name: a.name.trim(),
    email: a.email.trim(),
    website: a.website.trim(),
    make: [a.make],
    role: a.role,
    consent: true,
    hp: c.hp,
    startedAt: c.startedAt,
    formId: c.formId,
    consentVersion: "v1",
    ...c.extra,
  };
}

export type LeadOutcome = { kind: "ok" } | { kind: "field"; step: LeadStep; message: string } | { kind: "failed"; message: string };

/** Interpret the endpoint's answer. A field error sends the visitor back to that step; anything else is a failure to retry. */
export function interpretResponse(res: { ok: boolean; status: number; json: { ok?: boolean; errors?: Record<string, string> } | null }, genericError: string): LeadOutcome {
  if (res.ok && res.json?.ok) return { kind: "ok" };
  const errors = res.json?.errors;
  if (errors) {
    const step = (LEAD_STEPS as readonly string[]).find((s) => s in errors);
    if (step) return { kind: "field", step: step as LeadStep, message: errors[step] ?? genericError };
    const first = Object.values(errors)[0];
    return { kind: "failed", message: first ?? genericError };
  }
  return { kind: "failed", message: genericError };
}
