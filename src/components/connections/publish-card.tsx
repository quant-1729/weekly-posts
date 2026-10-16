import { alertClass, badge, cardClass, outlineButton, primaryButton, quietButton, secondaryButton } from "@/components/ui";
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
    <section className={`min-w-0 space-y-3 ${cardClass}`} data-connection={`publish-${provider}`} data-state={active ? "connected" : needsReconnect ? "expired" : ready ? "none" : "pending"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title text-title">{copy.title}</h2>
        {active ? (
          <span className={badge("ok")}>{t.card.connected}</span>
        ) : needsReconnect ? (
          <span className={badge("warn")}>{t.card.expired}</span>
        ) : !ready ? (
          <span className={badge("neutral")}>{t.card.setupPending}</span>
        ) : null}
      </div>

      {active && connection ? (
        <div className="space-y-1">
          {connection.accountName ? <p className="text-[14px] leading-5">{fill(t.card.account, { name: connection.accountName })}</p> : null}
          {connection.expiresAt ? (
            <p className={connection.expiresSoon ? alertClass("warn") : "text-[13px] leading-[18px] text-desc"}>
              {fill(connection.expiresSoon ? t.card.expiresSoon : t.card.expires, { date: formatDate(connection.expiresAt) })}
            </p>
          ) : (
            <p className="text-[13px] leading-[18px] text-desc">{t.card.neverExpires}</p>
          )}
        </div>
      ) : needsReconnect ? (
        <p className={alertClass("warn")}>{t.card.expiredBody}</p>
      ) : (
        <p className="text-[14px] leading-5">{copy.body}</p>
      )}

      {!active ? <p className="text-[13px] leading-[18px] text-desc" data-note="account-type">{copy.account}</p> : null}
      {!available ? <p className="text-[13px] leading-[18px] text-desc">{t.card.pendingBody}</p> : !keyOk ? <p className="text-[13px] leading-[18px] text-desc">{t.card.keyMissing}</p> : null}

      {!isOwner ? (
        <p className="text-[13px] leading-[18px] text-desc">{t.card.ownerOnly}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {ready ? (
            <a href={connectHref} className={active && !connection?.expiresSoon ? secondaryButton : primaryButton}>
              {active || needsReconnect ? t.card.reconnect : t.card.connect}
            </a>
          ) : (
            <button type="button" disabled className={primaryButton}>
              {t.card.connect}
            </button>
          )}
          {active || needsReconnect ? (
            <details className="w-full md:w-auto">
              <summary className={`${quietButton} cursor-pointer`}>{t.card.disconnect}</summary>
              <form action={disconnectAction} className="mt-2 space-y-2 rounded-lg border border-divider bg-cream p-3">
                <input type="hidden" name="provider" value={provider} />
                <p className="text-[13px] leading-[18px] text-desc">{t.card.disconnectConfirm}</p>
                <button type="submit" className={outlineButton}>
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
