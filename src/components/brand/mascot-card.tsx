"use client";

import Link from "next/link";
import { useState } from "react";
import { setMascotInPostsAction } from "@/app/(app)/brand/actions";
import { errorClass, hintClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import type { TweenColors } from "@/lib/mascot/colors";
import { renderTween } from "@/lib/mascot/tween";

const t = s.mascot.brandCard;

/**
 * The "Your mascot" card on the brand page (V-25, D9): Tween in the brand's colours, why a mascot is or is not
 * offered, a link to the mascot screen, and the "Use the mascot in my posts" switch. Turning the switch on makes
 * the brand's Tween when there is none. A formal brand confirms "Try anyway" on the mascot screen first.
 */
export function MascotCard({
  brandId,
  reason,
  active,
  inPosts,
  colors,
}: {
  brandId: string;
  reason: "regulated" | "formal" | "ok";
  active: { id: string; name: string } | null;
  inPosts: boolean;
  colors?: TweenColors;
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
  const canSwitch = reason !== "regulated" && (reason === "ok" || active !== null);
  const showTween = reason !== "regulated" || active !== null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {showTween ? (
          <div
            aria-hidden="true"
            className="w-20 shrink-0 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: renderTween({ pose: "wave", colors, size: 160 }) }}
          />
        ) : null}
        <p className="text-stone-700">{active ? fill(t.haveOne, { name: active.name }) : status}</p>
      </div>
      {reason !== "regulated" || active ? (
        <Link href="/mascot" className={`${active ? secondaryButton : primaryButton} inline-block text-center`}>
          {active ? t.manage : t.makeOne}
        </Link>
      ) : null}
      {canSwitch ? (
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
