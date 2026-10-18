import { s } from "@/lib/i18n/strings";

const t = s.live;

/** A small green dot with "Live": this screen updates as things happen. Renders nothing when it is not live. */
export function LiveDot({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span
      title={t.title}
      className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2 py-0.5 text-[12px] font-medium leading-4 text-ok-tx ring-1 ring-ok-bd"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-ok-tx" />
      {t.label}
    </span>
  );
}
