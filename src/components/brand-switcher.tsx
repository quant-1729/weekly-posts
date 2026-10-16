"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { switchBrandAction } from "@/app/(app)/switch-brand-action";
import { fill, s } from "@/lib/i18n/strings";

interface BrandOption {
  id: string;
  name: string;
}

/**
 * The current brand's name in the app header. With 2 or more brands it is a
 * button that opens a sheet to pick another one (R14); with one it is plain text.
 */
export function BrandSwitcher({ brands, currentId }: { brands: BrandOption[]; currentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = brands.find((b) => b.id === currentId);
  const name = current?.name ?? "";

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (brands.length < 2) {
    return <span className="min-w-0 max-w-[45%] truncate text-sm font-medium text-stone-700">{name}</span>;
  }

  function choose(id: string) {
    if (id === currentId) return setOpen(false);
    setFailed(false);
    startTransition(async () => {
      const res = await switchBrandAction(id, pathname);
      if (!res.ok) return setFailed(true);
      setOpen(false);
      if (res.redirectTo) router.push(res.redirectTo);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={fill(s.switcher.openLabel, { name })}
        className="flex min-h-11 min-w-0 max-w-[45%] items-center gap-1 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-800"
      >
        <span className="truncate">{name}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="brand-switcher-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A tap on the dimmed area (the dialog element itself) closes the sheet.
          if (e.target === dialogRef.current) setOpen(false);
        }}
        className="m-0 mx-auto mb-0 mt-auto w-full max-w-[480px] rounded-t-2xl bg-white p-0 backdrop:bg-black/40"
      >
        <div className="space-y-3 p-4">
          <h2 id="brand-switcher-title" className="text-card-title text-title">
            {s.switcher.title}
          </h2>
          <ul className="space-y-2">
            {brands.map((b) => {
              const isCurrent = b.id === currentId;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={pending}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => choose(b.id)}
                    className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-4 py-2 text-left text-base disabled:opacity-60 ${
                      isCurrent ? "border-coral bg-coral-tint font-medium" : "border-stone-300"
                    }`}
                  >
                    <span className="min-w-0 truncate">{b.name}</span>
                    {isCurrent && (
                      <span className="flex shrink-0 items-center gap-1 text-sm text-coral-dark">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                        <span className="sr-only">{s.switcher.current}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {pending && (
            <p role="status" className="text-sm text-stone-600">
              {s.switcher.working}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-sm text-red-700">
              {s.switcher.failed}
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base font-medium"
          >
            {s.switcher.close}
          </button>
        </div>
      </dialog>
    </>
  );
}
