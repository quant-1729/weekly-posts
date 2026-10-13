import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { getReuseSource } from "@/lib/posts/history";
import { CreateForm } from "./create-form";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps<"/create">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  // "Use again" from History: ?from={postId} pre-fills the earlier post's input (current brand only).
  const from = (await searchParams).from;
  const source = typeof from === "string" ? await getReuseSource(user.id, brand.id, from) : null;
  const reuse = source
    ? { postId: source.postId, text: source.text, photoUrl: source.photoPath ? `/api/files/${source.photoPath}` : null }
    : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{s.create.title}</h1>
        <p className="text-stone-600">{s.create.intro}</p>
      </div>
      <CreateForm key={reuse?.postId ?? "new"} reuse={reuse} />
    </section>
  );
}
