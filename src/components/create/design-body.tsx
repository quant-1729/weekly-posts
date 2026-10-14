import Link from "next/link";
import { DesignStudio } from "@/components/create/design-studio";
import { secondaryButton } from "@/components/ui";
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
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-design-message={page.state}>
      <p role={page.state === "not_ready" ? undefined : "alert"}>{text}</p>
      <Link href={`/create/${briefId}`} className={`${secondaryButton} inline-block text-center`}>
        {t.back}
      </Link>
    </div>
  );
}

/** Shown while the words are being written. */
export function DesignLoading() {
  const t = s.create.design;
  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 bg-white p-4" role="status" data-design-loading>
      <p className="font-semibold">{t.writingTitle}</p>
      <p className="text-sm text-stone-600">{t.writingHint}</p>
    </div>
  );
}
