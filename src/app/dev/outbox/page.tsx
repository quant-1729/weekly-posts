import { notFound } from "next/navigation";
import { isDevToolsEnabled } from "@/lib/env";
import { linksIn, listOutbox } from "@/lib/email/outbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev outbox", robots: { index: false, follow: false } };

/**
 * Developer-only list of the emails the mock sender wrote (newest first). It
 * is a 404 in production and on Vercel. Each email's HTML is shown in an
 * iframe with an empty sandbox (no scripts, no navigation) so a malicious
 * email body cannot run code in this page.
 */
export default async function OutboxPage({ searchParams }: { searchParams?: Promise<{ plain?: string }> } = {}) {
  if (!isDevToolsEnabled()) notFound();
  const emails = await listOutbox();
  // ?plain=1 shows each email's plain-text part instead of the HTML (what a client that blocks HTML shows).
  const plain = (await searchParams)?.plain === "1";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-medium">Dev outbox</h1>
      <p className="text-sm text-stone-600">
        Emails written by the mock sender to .data/outbox. Nothing here was really sent.{" "}
        <a href={plain ? "/dev/outbox" : "/dev/outbox?plain=1"} className="font-medium text-coral-dark underline">
          {plain ? "Show HTML" : "Show plain text"}
        </a>
      </p>
      {emails.length === 0 && <p className="text-[14px] leading-5 text-desc">No emails yet.</p>}
      {emails.map((m) => (
        <article key={m.id} className="space-y-2 rounded-lg border border-stone-300 bg-white p-4">
          <header className="text-sm">
            <p className="font-medium">{m.subject}</p>
            <p className="text-[14px] leading-5 text-desc">
              To {m.to} &middot; {m.kind} &middot; {m.createdAt}
            </p>
          </header>
          {linksIn(m.text).length > 0 && (
            <ul className="space-y-1 text-sm">
              {linksIn(m.text).map((url) => (
                <li key={url} className="break-all">
                  <a href={url} className="font-medium text-coral-dark underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {plain ? (
            <pre className="whitespace-pre-wrap break-words rounded border border-stone-200 bg-stone-50 p-3 text-sm">{m.text}</pre>
          ) : (
            <>
              <iframe
                title={m.subject}
                sandbox=""
                srcDoc={m.html}
                className="h-96 w-full rounded border border-stone-200 bg-white"
              />
              <details className="text-sm">
                <summary className="cursor-pointer text-stone-600">Plain-text version</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">{m.text}</pre>
              </details>
            </>
          )}
          {Object.keys(m.headers ?? {}).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-stone-600">Headers</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all">
                {Object.entries(m.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
              </pre>
            </details>
          )}
        </article>
      ))}
    </main>
  );
}
