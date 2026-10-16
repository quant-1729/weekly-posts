"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { errorClass, hintClass, inputClass, labelClass, linkButton, primaryButtonFull, secondaryButton } from "@/components/ui";
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

  if (step === "email") {
    return (
      <form onSubmit={send} className="space-y-5">
        <div>
          <label htmlFor="email" className={labelClass}>
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
          <p className={`${hintClass} mt-1`}>{s.login.emailHint}</p>
        </div>

        <label className="flex items-start gap-2.5 text-[13px] leading-[18px] text-sub">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="shrink-0"
            required
          />
          <span>
            {s.login.consent}{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-title">
              {s.login.termsLink}
            </Link>
          </span>
        </label>

        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}

        <button type="submit" disabled={pending || !consent} className={primaryButtonFull}>
          {pending ? s.login.sending : s.login.sendLink}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div role="status">
        <h2 className="mb-2 text-dialog text-title">{s.login.checkInboxTitle}</h2>
        <p className="text-[14px] leading-5">{fill(s.login.checkInboxBody, { email })}</p>
        <p className={`${hintClass} mt-2`}>{s.login.checkSpam}</p>
      </div>

      {notice && <p className="text-[13px] font-medium leading-[18px] text-ok-tx">{notice}</p>}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      <button type="button" onClick={() => send()} disabled={pending || wait > 0} className={`${secondaryButton} w-full`}>
        {wait > 0 ? fill(s.login.resendIn, { seconds: wait }) : pending ? s.login.sending : s.login.resend}
      </button>

      {showDevLink && (
        <p className="text-center">
          <Link href="/dev/outbox" className={linkButton}>
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
        className={linkButton}
      >
        {s.login.changeEmail}
      </button>
    </div>
  );
}
