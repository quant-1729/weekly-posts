import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { primaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { s } from "@/lib/i18n/strings";
import { getReviewData } from "@/lib/posts/review";
import { OutputCards } from "./output-cards";

export const dynamic = "force-dynamic";
// The language switch (a server action on this page) calls the AI and redraws the image.
export const maxDuration = 60;

/**
 * Result screen (R4), minimal. The cards carry the language switch (R5, T-6).
 * T-15 adds editing, regenerate and download.
 */
export default async function Page({ params }: PageProps<"/review/[postId]">) {
  const { postId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Not a member of the post's brand (or no such post): same 404.
  const data = await getReviewData(user.id, postId);
  if (!data) notFound();

  if (data.status === "failed" || data.status === "generating" || data.outputs.length === 0) {
    const failed = data.status !== "generating";
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-bold">{failed ? s.review.failedTitle : s.review.generatingTitle}</h1>
        <p className="text-stone-600">{failed ? s.review.failedBody : s.review.generatingBody}</p>
        <Link href="/create" className={`${primaryButton} block text-center`}>
          {s.review.makeAnother}
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{s.review.title}</h1>
        <p className="text-stone-600">
          {s.review.language}: <span className="font-medium">{s.review.languageNames[data.language]}</span>
        </p>
      </div>

      <OutputCards initial={data.outputs} />

      <Link href="/create" className={`${primaryButton} block text-center`}>
        {s.review.makeAnother}
      </Link>
    </section>
  );
}
