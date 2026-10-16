import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cardClass, pickCardClass, primaryButton, secondaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { FB_PENDING_COOKIE } from "@/lib/connections/facebook";
import { listPendingPages } from "@/lib/connections/oauth";
import { ConnectionError, type PagePick } from "@/lib/connections/types";
import { s } from "@/lib/i18n/strings";
import { cancelFacebookPickAction, chooseFacebookPageAction } from "../actions";

export const dynamic = "force-dynamic";

const t = s.connections;

/**
 * After Facebook Login when the owner manages more than one Page: choose which one we post to. Only Page ids and
 * names are shown; the Page tokens stay on the server.
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let pages: PagePick[] = [];
  try {
    pages = (await listPendingPages({ userId: user.id, pending: (await cookies()).get(FB_PENDING_COOKIE)?.value })).pages;
  } catch (e) {
    redirect(`/connections?connect_error=${e instanceof ConnectionError ? e.code : "exchange_failed"}`);
  }

  return (
    <section className="mx-auto w-full max-w-page-sm space-y-4">
      <div>
        <h1 className="text-section text-title">{t.pick.title}</h1>
        <p className="mt-1 text-[14px] leading-5 text-desc">{t.pick.intro}</p>
      </div>
      {pages.length === 0 ? (
        <p className="text-[14px] leading-5 text-desc">{t.pick.none}</p>
      ) : (
        <form action={chooseFacebookPageAction} className={`space-y-3 ${cardClass}`}>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t.pick.title}</legend>
            {pages.map((p, i) => (
              <label key={p.id} className={`${pickCardClass(i === 0)} items-center`}>
                <input type="radio" name="page" value={p.id} defaultChecked={i === 0} required />
                <span className="text-ui text-title">{p.name}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className={primaryButton}>
            {t.pick.button}
          </button>
        </form>
      )}
      <form action={cancelFacebookPickAction}>
        <button type="submit" className={secondaryButton}>
          {t.pick.cancel}
        </button>
      </form>
    </section>
  );
}
