"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { secondaryButton } from "@/components/ui";

/**
 * "Last updated" time, a Refresh button and an optional 60-second auto-refresh. Refreshing re-runs the
 * server page, which checks admin access again before it reads anything.
 */
export function AdminToolbar({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [auto, setAuto] = useState(false);
  const [pending, start] = useTransition();
  const refresh = () => start(() => router.refresh());

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [auto, router]);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-600">
      <span>Last updated {updatedAt}</span>
      <button type="button" onClick={refresh} disabled={pending} className={`${secondaryButton} !min-w-0 !px-4 !py-2 !text-sm !w-auto`}>
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-[#E4572E]" />
        Refresh every 60 seconds
      </label>
    </div>
  );
}
