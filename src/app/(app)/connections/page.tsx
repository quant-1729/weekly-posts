import Link from "next/link";
import { redirect } from "next/navigation";
import { InstagramCard } from "@/components/instagram/instagram-card";
import { PublishCard } from "@/components/connections/publish-card";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { connectAvailable } from "@/lib/connections/config";
import { tokenEncryptionAvailable } from "@/lib/connections/crypto";
import { isBrandOwner, listConnections } from "@/lib/connections/service";
import { listContacts } from "@/lib/contacts/service";
import { fill, s } from "@/lib/i18n/strings";
import { getInstagramState } from "@/lib/instagram/import";
import { disconnectAction } from "./actions";

export const dynamic = "force-dynamic";

const t = s.connections;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The result banner from ?connected=, ?disconnected= or ?connect_error=. */
function banner(sp: Search): { kind: "ok" | "error"; text: string } | null {
  const error = one(sp.connect_error);
  if (error) return { kind: "error", text: (t.errors as Record<string, string>)[error] ?? t.errors.exchange_failed };
  if (one(sp.connected)) return { kind: "ok", text: t.result.connected };
  if (one(sp.disconnected)) return { kind: "ok", text: t.result.disconnected };
  return null;
}

/**
 * Connections (C-02, C-25): the Instagram import (reads public posts, no login), the two publishing connections
 * (Connect / Connected / Reconnect / Disconnect), and the saved YouTube channel. Reads the database only; Instagram,
 * Facebook and YouTube are never called while the page renders.
 */
export default async function Page({ searchParams }: { searchParams?: Promise<Search> } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const [instagram, contacts, connections, owner] = await Promise.all([
    getInstagramState(user.id, brand.id),
    listContacts(user.id, brand.id),
    listConnections(user.id, brand.id),
    isBrandOwner(user.id, brand.id),
  ]);
  const youtube = contacts.find((c) => c.kind === "youtube") ?? null;
  const note = banner((await searchParams) ?? {});
  const keyOk = tokenEncryptionAvailable();
  const byProvider = (p: "instagram" | "facebook") => connections.find((c) => c.provider === p) ?? null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{t.title}</h1>
        <p className="text-stone-600">{t.intro}</p>
      </div>

      {note ? (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          data-connection-banner={note.kind}
          className={`rounded-lg px-3 py-2 ${note.kind === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}
        >
          {note.text}
        </p>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4" data-connection="instagram-import">
        <InstagramCard brandId={brand.id} initial={instagram} />
        <p className="mt-3 text-sm text-stone-600" data-note="import-vs-connect">
          {t.importVsConnect}
        </p>
      </section>

      <div>
        <h2 className="text-lg font-bold">{t.publishHeading}</h2>
        <p className="text-stone-600">{t.publishIntro}</p>
      </div>
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
        {(["instagram", "facebook"] as const).map((provider) => (
          <PublishCard
            key={provider}
            provider={provider}
            available={connectAvailable(provider)}
            keyOk={keyOk}
            isOwner={owner}
            connection={byProvider(provider)}
            disconnectAction={disconnectAction}
          />
        ))}
      </div>

      <section className="space-y-2 rounded-2xl border border-stone-200 bg-white p-4" data-connection="youtube">
        <h2 className="text-lg font-bold">{t.youtube.title}</h2>
        {youtube ? (
          <p className="font-medium">{fill(t.youtube.saved, { handle: youtube.display ?? youtube.value })}</p>
        ) : (
          <p className="text-stone-700">
            {t.youtube.none}{" "}
            <Link href="/brand#contacts" className="underline">
              {t.youtube.add}
            </Link>
          </p>
        )}
        <p className="text-sm text-stone-600">{t.youtube.note}</p>
      </section>
    </section>
  );
}
