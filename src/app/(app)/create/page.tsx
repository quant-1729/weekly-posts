import { redirect } from "next/navigation";
import { BriefEditor } from "@/components/create/brief-editor";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { loadEditorData } from "@/lib/briefs/editor-data";

export const dynamic = "force-dynamic";

/** Create a post, step 1 of 4 (Details): a new brief. The editor autosaves it and moves to /create/{briefId}. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) redirect("/setup");

  const data = await loadEditorData(user.id, brand.id);
  return <BriefEditor key="new" data={data} initialBrief={null} />;
}
