"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { smallButton } from "@/components/ui";

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] leading-[18px] text-desc">
      <span>Last updated {updatedAt}</span>
      <button type="button" onClick={refresh} disabled={pending} className={smallButton}>
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)}  />
        Refresh every 60 seconds
      </label>
    </div>
  );
}
