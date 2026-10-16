import { Mark } from "@/components/app-shell/nav-icon";
import { cardClass } from "@/components/ui";
import { s } from "@/lib/i18n/strings";

/**
 * The frame of the sign-in pages and the other single-card pages (invalid link, account deleted, data deletion):
 * the mark and app name, then the card. Centred on a cream page, 480 px wide.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-4 py-6">
      <div className={`${cardClass} p-6 md:p-10`}>
        <div className="flex items-center gap-2">
          <Mark />
          <span className="text-card-title text-title">{s.appName}</span>
        </div>
        {children}
      </div>
    </main>
  );
}
