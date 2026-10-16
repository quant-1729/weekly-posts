"use client";

import { useRef, useState, useTransition } from "react";
import { writeReviewReplyAction, type ReviewReplyActionResult } from "@/app/(app)/results/review-actions";
import { alertClass, cardClass, errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { languageOptions } from "@/lib/setup/languages";

const t = s.reviews;
const kindLabels = s.approvals.flags.kinds as Record<string, string>;

type Ok = Extract<ReviewReplyActionResult, { ok: true }>;

/**
 * Reply to a review (Req 26, stretch): paste a customer review, get a reply in the owner's voice, copy
 * it by hand into Google or another site. Flags are shown but never block. Nothing is saved.
 */
export function ReviewReplyCard() {
  const [review, setReview] = useState("");
  const [language, setLanguage] = useState("");
  const [result, setResult] = useState<Ok | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [pending, start] = useTransition();
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const options = languageOptions();

  const run = () => {
    setError(null);
    setCopy("idle");
    start(async () => {
      const res = await writeReviewReplyAction(review, language);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res);
      setReply(res.reply);
    });
  };

  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setCopy("done");
      return;
    } catch {
      // Older browsers and non-secure pages: select the text and use the old copy command.
    }
    const box = replyRef.current;
    let ok = false;
    if (box) {
      box.focus();
      box.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopy(ok ? "done" : "failed");
  };

  return (
    <section aria-labelledby="review-title" className={`space-y-4 ${cardClass}`}>
      <div>
        <h2 id="review-title" className="text-card-title text-title">
          {t.title}
        </h2>
        <p className="text-[13px] leading-[18px] text-desc">{t.intro}</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="review-text">
          {t.reviewLabel}
        </label>
        <textarea
          id="review-text"
          className={inputClass}
          rows={5}
          maxLength={3000}
          placeholder={t.reviewPlaceholder}
          value={review}
          onChange={(e) => setReview(e.target.value)}
          aria-describedby="review-hint"
        />
        <p id="review-hint" className={hintClass}>
          {t.reviewHint}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="review-language">
          {t.languageLabel}
        </label>
        <select id="review-language" className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">{t.languageSame}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!result && (
        <button type="button" className={primaryButton} disabled={pending || review.trim().length === 0} onClick={run}>
          {pending ? t.writing : t.write}
        </button>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3" aria-live="polite">
          {result.needsAttention && (
            <p role="alert" className={`${alertClass("warn")} border-2 border-warn-tx`}>
              {result.attentionReason ? fill(t.attention, { reason: result.attentionReason }) : t.attentionNoReason}
            </p>
          )}

          {result.flags.length > 0 && (
            <div className={alertClass("warn")}>
              <h3 className="text-ui text-warn-tx">{t.flagsTitle}</h3>
              <p className="text-[13px] leading-[18px]">{t.flagsIntro}</p>
              <ul className="mt-1 space-y-1 text-[13px] leading-[18px]">
                {result.flags.map((f) => (
                  <li key={`${f.kind}:${f.text}`}>
                    <span className="text-desc">{kindLabels[f.kind] ?? f.kind}: </span>
                    <mark>{f.text}</mark>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-note text-desc">{t.flagsNote}</p>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="review-reply">
              {t.replyLabel}
            </label>
            <textarea
              id="review-reply"
              ref={replyRef}
              className={inputClass}
              rows={7}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                setCopy("idle");
              }}
            />
          </div>

          <div className="flex gap-2">
            <button type="button" className={primaryButton} onClick={copyReply} disabled={reply.trim().length === 0}>
              {copy === "done" ? t.copied : t.copy}
            </button>
            <button type="button" className={secondaryButton} onClick={run} disabled={pending}>
              {pending ? t.writing : t.tryAgain}
            </button>
          </div>
          <p role="status" className="min-h-5 text-[13px] leading-[18px] text-desc">
            {copy === "failed" ? t.copyFailed : ""}
          </p>
        </div>
      )}
    </section>
  );
}
