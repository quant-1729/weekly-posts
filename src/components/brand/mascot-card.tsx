"use client";

import Link from "next/link";
import { useState } from "react";
import { setMascotInPostsAction } from "@/app/(app)/brand/actions";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";

const t = s.mascot.brandCard;

/**
 * The "Your mascot" card on the brand page (V-25): why a mascot is or is not offered, a link to the
 * mascot screen, and (only once a mascot exists) the "Use my mascot in posts" switch.
 */
export function MascotCard({
  brandId,
  reason,
  active,
  inPosts,
}: {
  brandId: string;
  reason: "regulated" | "formal" | "ok";
  active: { id: string; name: string } | null;
  inPosts: boolean;
}) {
  const [on, setOn] = useState(inPosts);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage(null);
    const r = await setMascotInPostsAction(brandId, next);
    setBusy(false);
    if (r.ok) {
      setOn(next);
      setMessage({ ok: true, text: t.saved });
    } else {
      setMessage({ ok: false, text: r.message });
    }
  }

  const status = reason === "regulated" ? t.statusRegulated : reason === "formal" ? t.statusFormal : t.statusOk;
  return (
    <div className="space-y-3">
      <p className="text-stone-700">{active ? fill(t.haveOne, { name: active.name }) : status}</p>
      {reason !== "regulated" || active ? (
        <Link href="/mascot" className={`${active ? secondaryButton : primaryButton} block text-center`}>
          {active ? t.manage : t.makeOne}
        </Link>
      ) : null}
      {active && reason !== "regulated" ? (
        <div className="space-y-1">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-6"
              checked={on}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="font-medium">{t.useInPosts}</span>
          </label>
          <p className={hintClass}>{t.useInPostsHelp}</p>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-stone-600">
          {t.saving}
        </p>
      ) : message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-green-700" : errorClass}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
