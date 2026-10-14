"use client";

import { useState, useTransition } from "react";
import { addPaymentIdAction, retirePaymentIdAction } from "@/app/(app)/brand/payment-actions";
import { errorClass, hintClass, inputClass, labelClass, secondaryButton, primaryButton } from "@/components/ui";
import { paymentCopy } from "@/lib/payments/copy";
import type { PaymentIdView } from "@/lib/payments";

const t = paymentCopy.card;

export interface PaymentPreview {
  /** SVG of the QR code, drawn by our own code (a data URI is built from it). */
  svg: string;
  address: string;
  payeeName: string;
}

/**
 * The "Payment QR code" card on the Brand page (PRD v3 B-4.1): add a UPI ID (owner only), see
 * whether it is waiting for the email confirmation, active or retired, retire it, and preview
 * the QR with the ID and the payee name printed under it.
 */
export function PaymentCard({
  brandId,
  supported,
  isOwner,
  items,
  preview,
}: {
  brandId: string;
  /** True when a payment scheme exists for the brand's country (UPI: India). */
  supported: boolean;
  isOwner: boolean;
  items: PaymentIdView[];
  preview: PaymentPreview | null;
}) {
  const [address, setAddress] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [errors, setErrors] = useState<{ address?: string; payeeName?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!supported) return <p className="text-stone-600">{t.otherCountry}</p>;

  function add() {
    setError(null);
    setSent(false);
    const next: { address?: string; payeeName?: string } = {};
    if (!/^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(address.trim())) next.address = t.errors.address;
    const name = payeeName.trim().replace(/\s+/g, " ");
    if (name.length < 1 || [...name].length > 60) next.payeeName = t.errors.payeeName;
    setErrors(next);
    if (next.address || next.payeeName) return;
    startTransition(async () => {
      const r = await addPaymentIdAction(brandId, { scheme: "upi", address: address.trim(), payeeName: name });
      if (!r.ok) {
        if (r.field) setErrors({ [r.field]: r.message });
        else setError(r.message);
        return;
      }
      setAddress("");
      setPayeeName("");
      setSent(true);
    });
  }

  function retire(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await retirePaymentIdAction(brandId, id);
      if (!r.ok) setError(r.message);
    });
  }

  const status = (p: PaymentIdView) => (p.status === "pending" ? t.statusPending : p.status === "active" ? t.statusActive : t.statusRetired);
  const live = items.filter((p) => p.status !== "retired");
  const retired = items.filter((p) => p.status === "retired").slice(0, 3);

  return (
    <div className="space-y-4">
      <p className="text-stone-600">{t.intro}</p>

      {[...live, ...retired].length > 0 && (
        <ul className="space-y-2">
          {[...live, ...retired].map((p) => (
            <li key={p.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${p.status === "retired" ? "border-stone-200 text-stone-500" : "border-stone-300"}`}>
              <span>
                <span className="block font-medium">
                  UPI · {p.address}
                </span>
                <span className="block text-sm text-stone-600">{p.payeeName}</span>
                <span className={`block text-sm ${p.status === "active" ? "text-green-800" : p.status === "pending" ? "text-amber-800" : "text-stone-500"}`}>{status(p)}</span>
              </span>
              {isOwner && p.status !== "retired" && (
                <button type="button" className="min-h-10 shrink-0 text-sm text-red-700 underline" disabled={pending} onClick={() => retire(p.id)}>
                  {pending ? t.retiring : t.retire}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <figure className="w-48 space-y-1 rounded-xl border border-stone-200 bg-white p-3 text-center">
          <figcaption className="sr-only">{t.previewTitle}</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={t.previewTitle} width={168} height={168} className="mx-auto" src={`data:image/svg+xml;utf8,${encodeURIComponent(preview.svg)}`} />
          <p className="text-sm font-medium">{t.printedUnder}</p>
          <p className="break-all text-sm">{preview.address}</p>
          <p className="text-sm text-stone-600">{preview.payeeName}</p>
        </figure>
      )}

      {isOwner ? (
        <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-3">
          <div>
            <label htmlFor="pay-scheme" className={labelClass}>
              {t.schemeLabel}
            </label>
            <select id="pay-scheme" className={inputClass} value="upi" disabled onChange={() => undefined}>
              <option value="upi">UPI</option>
            </select>
          </div>
          <div>
            <label htmlFor="pay-address" className={labelClass}>
              {t.addressLabel}
            </label>
            <p className={hintClass}>{t.addressHint}</p>
            <input id="pay-address" className={inputClass} value={address} placeholder="name@bank" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={320} onChange={(e) => setAddress(e.target.value)} />
            {errors.address && (
              <p role="alert" className={errorClass}>
                {errors.address}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="pay-name" className={labelClass}>
              {t.payeeLabel}
            </label>
            <p className={hintClass}>{t.payeeHint}</p>
            <input id="pay-name" className={inputClass} value={payeeName} maxLength={60} onChange={(e) => setPayeeName(e.target.value)} />
            {errors.payeeName && (
              <p role="alert" className={errorClass}>
                {errors.payeeName}
              </p>
            )}
          </div>
          <button type="button" className={items.length > 0 ? secondaryButton : primaryButton} disabled={pending} onClick={add}>
            {pending ? t.adding : t.add}
          </button>
          {sent && (
            <p role="status" className="text-sm text-green-800">
              {t.sent}
            </p>
          )}
          {error && (
            <p role="alert" className={errorClass}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="text-stone-600">{t.noOwner}</p>
      )}
    </div>
  );
}
