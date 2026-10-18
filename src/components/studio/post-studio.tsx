"use client";

import { finishStudioAction, saveStudioAction, smartFitAction } from "@/app/(app)/create/[briefId]/studio-actions";
import type { StudioPage } from "@/lib/studio/service";
import { Studio } from "./studio";

/** The Design Studio for one post brief (Create a post, step 3). */
export function PostStudio({ page, brandId }: { page: StudioPage; brandId: string }) {
  return (
    <Studio
      brandId={brandId}
      input={page.input}
      formats={page.formats}
      initial={page.initial}
      photos={page.photos}
      contacts={page.contacts}
      checks={page.checks}
      save={(state) => saveStudioAction(page.briefId, state)}
      finish={(state) => finishStudioAction(page.briefId, state)}
      smartFit={(a) => smartFitAction(a) as never}
      finishLabel="Use this design"
      backHref={`/create/${page.briefId}/show`}
      backLabel="Back"
    />
  );
}
