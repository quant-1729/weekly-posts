import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { primaryButtonFull } from "@/components/ui";

/** The 404 page: the same calm card as the sign-in pages. */
export default function NotFound() {
  return (
    <AuthCard>
      <h1 className="mt-6 text-dialog text-title">We could not find that page</h1>
      <p className="mb-6 mt-2 text-[14px] leading-5 text-desc">The link may be old or mistyped. You can go back to the start.</p>
      <Link href="/" className={primaryButtonFull}>
        Go to the start
      </Link>
    </AuthCard>
  );
}
