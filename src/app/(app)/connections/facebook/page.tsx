import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { primaryButton, secondaryButton } from "@/components/ui";
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
    <section className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{t.pick.title}</h1>
        <p className="text-stone-600">{t.pick.intro}</p>
      </div>
      {pages.length === 0 ? (
        <p className="text-stone-700">{t.pick.none}</p>
      ) : (
        <form action={chooseFacebookPageAction} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">{t.pick.title}</legend>
            {pages.map((p, i) => (
              <label key={p.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-stone-300 px-3 py-2">
                <input type="radio" name="page" value={p.id} defaultChecked={i === 0} required />
                <span className="font-medium">{p.name}</span>
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
