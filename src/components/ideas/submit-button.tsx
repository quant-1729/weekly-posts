"use client";

import { useFormStatus } from "react-dom";

/** A submit button that waits while its form's server action runs. Works as a plain button without JavaScript. */
export function SubmitButton({ className, disabled, children }: { className: string; disabled?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {children}
    </button>
  );
}
