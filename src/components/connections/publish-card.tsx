import { primaryButton, secondaryButton } from "@/components/ui";
import type { ConnectionView } from "@/lib/connections/types";
import { fill, s } from "@/lib/i18n/strings";
import type { Provider } from "@/lib/queue/types";

const t = s.connections;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export interface PublishCardProps {
  provider: Provider;
  /** Meta app details are set on the server. */
  available: boolean;
  /** TOKEN_ENCRYPTION_KEY (or a development key) is available. */
  keyOk: boolean;
  /** Only an owner can connect or disconnect. */
  isOwner: boolean;
  connection: ConnectionView | null;
  disconnectAction: (formData: FormData) => void | Promise<void>;
}

/**
 * One publishing connection (C-25): Connect, or Connected (account, when the permission ends, Reconnect, Disconnect), or
 * a "needs reconnecting" warning. Plain server markup: the buttons are a link to the connect route and a form that posts
 * to a server action, so nothing here needs the browser.
 */
export function PublishCard({ provider, available, keyOk, isOwner, connection, disconnectAction }: PublishCardProps) {
  const copy = provider === "instagram" ? t.publishInstagram : t.publishFacebook;
  const active = connection?.status === "active";
  const needsReconnect = connection !== null && (connection.status === "expired" || connection.status === "error");
  const connectHref = `/api/connect/${provider}`;
  const ready = available && keyOk;

  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-connection={`publish-${provider}`} data-state={active ? "connected" : needsReconnect ? "expired" : ready ? "none" : "pending"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{copy.title}</h2>
        {active ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-900">{t.card.connected}</span>
        ) : needsReconnect ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">{t.card.expired}</span>
        ) : !ready ? (
          <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700">{t.card.setupPending}</span>
        ) : null}
      </div>

      {active && connection ? (
        <div className="space-y-1">
          {connection.accountName ? <p className="font-medium">{fill(t.card.account, { name: connection.accountName })}</p> : null}
          {connection.expiresAt ? (
            <p className={connection.expiresSoon ? "text-amber-800" : "text-sm text-stone-600"}>
              {fill(connection.expiresSoon ? t.card.expiresSoon : t.card.expires, { date: formatDate(connection.expiresAt) })}
            </p>
          ) : (
            <p className="text-sm text-stone-600">{t.card.neverExpires}</p>
          )}
        </div>
      ) : needsReconnect ? (
        <p className="text-amber-900">{t.card.expiredBody}</p>
      ) : (
        <p className="text-stone-700">{copy.body}</p>
      )}

      {!active ? <p className="text-sm text-stone-600" data-note="account-type">{copy.account}</p> : null}
      {!available ? <p className="text-sm text-stone-600">{t.card.pendingBody}</p> : !keyOk ? <p className="text-sm text-stone-600">{t.card.keyMissing}</p> : null}

      {!isOwner ? (
        <p className="text-sm text-stone-600">{t.card.ownerOnly}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          {ready ? (
            <a href={connectHref} className={`${active && !connection?.expiresSoon ? secondaryButton : primaryButton} text-center`}>
              {active || needsReconnect ? t.card.reconnect : t.card.connect}
            </a>
          ) : (
            <button type="button" disabled className={primaryButton}>
              {t.card.connect}
            </button>
          )}
          {active || needsReconnect ? (
            <details className="w-full md:w-auto">
              <summary className="cursor-pointer py-3 text-base text-stone-700 underline">{t.card.disconnect}</summary>
              <form action={disconnectAction} className="mt-2 space-y-2 rounded-lg border border-stone-200 p-3">
                <input type="hidden" name="provider" value={provider} />
                <p className="text-sm text-stone-700">{t.card.disconnectConfirm}</p>
                <button type="submit" className={secondaryButton}>
                  {t.card.disconnectYes}
                </button>
              </form>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
