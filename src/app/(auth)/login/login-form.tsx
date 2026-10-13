"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { fill, s } from "@/lib/i18n/strings";
import { requestLinkAction } from "./actions";

const errors = s.login.errors as Record<string, string>;
const RESEND_SECONDS = 60;

export function LoginForm({ showDevLink }: { showDevLink: boolean }) {
  const [step, setStep] = useState<"email" | "sent">("email");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, startTransition] = useTransition();

  // Counts the resend cooldown down once a second.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await requestLinkAction(email, consent);
      if (res.ok) {
        const resent = step === "sent";
        setEmail(res.email);
        setStep("sent");
        setWait(RESEND_SECONDS);
        if (resent) setNotice(s.login.resent);
      } else {
        setError(errors[res.error] ?? errors.generic);
      }
    });
  }

  const inputClass =
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-lg outline-none focus:border-[#E4572E] focus:ring-2 focus:ring-[#E4572E]/30";
  const buttonClass =
    "w-full rounded-lg bg-[#E4572E] px-4 py-3 text-lg font-semibold text-white disabled:opacity-60";

  if (step === "email") {
    return (
      <form onSubmit={send} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block font-medium">
            {s.login.emailLabel}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder={s.login.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
            autoFocus
          />
          <p className="mt-1 text-sm text-stone-500">{s.login.emailHint}</p>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#E4572E]"
            required
          />
          <span>
            {s.login.consent}{" "}
            <Link href="/terms" className="underline">
              {s.login.termsLink}
            </Link>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending || !consent} className={buttonClass}>
          {pending ? s.login.sending : s.login.sendLink}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div role="status">
        <h2 className="mb-2 text-xl font-semibold">{s.login.checkInboxTitle}</h2>
        <p>{fill(s.login.checkInboxBody, { email })}</p>
        <p className="mt-2 text-sm text-stone-500">{s.login.checkSpam}</p>
      </div>

      {notice && <p className="text-sm text-green-800">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="button" onClick={() => send()} disabled={pending || wait > 0} className={buttonClass}>
        {wait > 0 ? fill(s.login.resendIn, { seconds: wait }) : pending ? s.login.sending : s.login.resend}
      </button>

      {showDevLink && (
        <p className="text-center">
          <Link href="/dev/outbox" className="text-sm font-medium text-[#E4572E] underline">
            {s.login.devOpenLink}
          </Link>
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setStep("email");
          setError(null);
          setNotice(null);
        }}
        className="w-full py-2 text-sm text-stone-600 underline"
      >
        {s.login.changeEmail}
      </button>
    </div>
  );
}
