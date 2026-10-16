import Link from "next/link";
import { DesignStudio } from "@/components/create/design-studio";
import { cardClass, secondaryButton } from "@/components/ui";
import { loadDesignPage } from "@/lib/create";
import { s } from "@/lib/i18n/strings";

/** The design step's content: writes the words on the first visit (one AI call), then shows the three options. */
export async function DesignBody({ userId, brandId, briefId }: { userId: string; brandId: string; briefId: string }) {
  const t = s.create.design;
  let page;
  try {
    page = await loadDesignPage({ userId, brandId, briefId });
  } catch (e) {
    console.error("[create] design step failed", e);
    page = { state: "error" as const, message: t.errors.generic };
  }
  if (page.state === "ready") return <DesignStudio key={page.version} data={page} />;
  const text = page.state === "not_ready" ? t.missing : page.message;
  return (
    <div className={`space-y-3 ${cardClass}`} data-design-message={page.state}>
      <p role={page.state === "not_ready" ? undefined : "alert"}>{text}</p>
      <Link href={`/create/${briefId}`} className={secondaryButton}>
        {t.back}
      </Link>
    </div>
  );
}

/** Shown while the words are being written. */
export function DesignLoading() {
  const t = s.create.design;
  return (
    <div className={`space-y-1 ${cardClass}`} role="status" data-design-loading>
      <p className="flex items-center gap-2 text-card-title text-title">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-ink" aria-hidden="true" />
        {t.writingTitle}
      </p>
      <p className="text-[13px] leading-[18px] text-desc">{t.writingHint}</p>
    </div>
  );
}
