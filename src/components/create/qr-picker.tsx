"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { checkQrLinkAction } from "@/app/(app)/create/actions";
import { errorClass, hintClass, inputClass, labelClass, linkButton, wellClass } from "@/components/ui";
import type { PaymentChoice } from "@/lib/briefs/editor-data";
import { qrTargetUrl, type QrDraft } from "@/lib/briefs/editor-state";
import { QR_LINK_TARGETS, type QrLinkTarget } from "@/lib/briefs/types";
import type { ContactPoint } from "@/lib/contacts/types";
import { fill, s } from "@/lib/i18n/strings";
import { EditorCard, pickClass } from "./card";

const t = s.create.qr;

/**
 * QR code (B-4.1): none, a link (we count the scans) or a payment QR. A payment QR is offered
 * only when the brand has a payment ID confirmed by email; otherwise there is a link to set one up.
 * The payment ID is shown to the owner as text and is never sent anywhere from here.
 */
export function QrPicker({
  brandId,
  qr,
  contacts,
  payment,
  error,
  onChange,
}: {
  brandId: string;
  qr: QrDraft;
  contacts: ContactPoint[];
  payment: PaymentChoice | null;
  /** From the last save (the link was refused). */
  error?: string | null;
  onChange: (qr: QrDraft) => void;
}) {
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function setMode(mode: QrDraft["mode"]) {
    setChecked(null);
    if (mode === "none") onChange({ mode: "none" });
    else if (mode === "link") onChange({ mode: "link", target: "website", url: qrTargetUrl("website", contacts) });
    else if (payment) onChange({ mode: "payment", paymentId: payment.id });
  }

  function setTarget(target: QrLinkTarget) {
    setChecked(null);
    onChange({ mode: "link", target, url: qrTargetUrl(target, contacts) });
  }

  function checkLink(url: string) {
    if (!url.trim()) return;
    setChecked({ ok: true, text: t.checking });
    startTransition(async () => {
      const r = await checkQrLinkAction(brandId, url);
      setChecked(r.ok ? { ok: true, text: t.linkOk } : { ok: false, text: r.message });
    });
  }

  const modes: Array<{ mode: QrDraft["mode"]; label: string; hint?: string; disabled?: boolean }> = [
    { mode: "none", label: t.none },
    { mode: "link", label: t.link, hint: t.linkHint },
    { mode: "payment", label: t.payment, hint: payment ? undefined : t.paymentOff, disabled: !payment },
  ];

  return (
    <EditorCard id="qr" title={t.title} hint={t.hint}>
      <fieldset className="min-w-0">
        <legend className="sr-only">{t.title}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {modes.map((m) => (
            <label key={m.mode} className={pickClass(qr.mode === m.mode, m.disabled)}>
              <input
                type="radio"
                name="qr-mode"
                className="mt-0.5 shrink-0"
                checked={qr.mode === m.mode}
                disabled={m.disabled}
                onChange={() => setMode(m.mode)}
              />
              <span className="min-w-0">
                <span className="block text-ui text-title">{m.label}</span>
                {m.hint && <span className="mt-0.5 block break-words text-note text-desc">{m.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {!payment && (
        <p>
          <Link href="/brand#payment" className={linkButton}>
            {t.paymentSetup}
          </Link>
        </p>
      )}

      {qr.mode === "link" && (
        <div data-qr-link className="space-y-3">
          <div>
            <label htmlFor="qr-target" className={labelClass}>
              {t.targetLabel}
            </label>
            <select id="qr-target" className={inputClass} value={qr.target} onChange={(e) => setTarget(e.target.value as QrLinkTarget)}>
              {QR_LINK_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {t.targets[target]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qr-url" className={labelClass}>
              {t.urlLabel}
            </label>
            <input
              id="qr-url"
              className={inputClass}
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder={t.urlPlaceholder}
              value={qr.url}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setChecked(null);
                onChange({ mode: "link", target: qr.target, url: e.target.value });
              }}
              onBlur={(e) => checkLink(e.target.value)}
            />
            {!qr.url.trim() && qr.target !== "custom" && <p className={hintClass}>{t.noLinkForTarget}</p>}
            {checked && (
              <p role={checked.ok ? "status" : "alert"} className={checked.ok ? "mt-1 flex items-center gap-1.5 text-[13px] font-medium leading-[18px] text-ok-tx" : errorClass}>
                {pending ? t.checking : checked.text}
              </p>
            )}
            {error && (
              <p role="alert" className={errorClass}>
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {qr.mode === "payment" && payment && (
        <p data-qr-payment className={`break-words text-[14px] leading-5 ${wellClass}`}>
          {fill(t.paymentFor, { payee: payment.payeeName, address: payment.address })}
          <span className="mt-1 block text-[13px] leading-[18px] text-desc">{t.paymentHint}</span>
        </p>
      )}
    </EditorCard>
  );
}
