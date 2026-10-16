export function NavIcon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The small coral square with three lines that stands in for a logo (the app has no image logo). */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-lg bg-coral text-white" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8h14M5 12h14M5 16h9" />
      </svg>
    </span>
  );
}
