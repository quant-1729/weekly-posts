import { notFound, redirect } from "next/navigation";
import { BriefEditor } from "@/components/create/brief-editor";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { loadEditorData } from "@/lib/briefs/editor-data";
import { getBrief } from "@/lib/briefs/service";

export const dynamic = "force-dynamic";

/** Create a post, step 1 of 5 (Details), for an existing brief (draft or ready). Another brand's brief is "not found". */
export default async function Page({ params }: PageProps<"/create/[briefId]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const { briefId } = await params;
  const brief = await getBrief(user.id, brand.id, briefId);
  if (!brief) notFound();
  const data = await loadEditorData(user.id, brand.id);
  return <BriefEditor key={brief.id} data={data} initialBrief={brief} />;
}
