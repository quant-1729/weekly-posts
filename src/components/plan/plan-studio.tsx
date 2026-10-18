"use client";

import { finishPlanDesignAction, planSmartFitAction, savePlanStudioAction } from "@/app/(app)/plan/actions";
import { Studio, type PlanDayView } from "@/components/studio/studio";
import type { StudioPage } from "@/lib/studio/service";
import type { StudioState } from "@/lib/studio/types";

export function PlanStudio({ planId, brandId, page, initial, days }: { planId: string; brandId: string; page: StudioPage; initial: StudioState | null; days: PlanDayView[] }) {
  return (
    <Studio
      brandId={brandId}
      input={page.input}
      formats={page.formats}
      initial={initial}
      photos={page.photos}
      contacts={page.contacts}
      checks={page.checks}
      plan={{ days }}
      title={`${days.length} posts, one look`}
      save={(state) => savePlanStudioAction(planId, state)}
      finish={(state) => finishPlanDesignAction(planId, state)}
      smartFit={(a) => planSmartFitAction(a) as never}
      finishLabel={`Use for all ${days.length} days`}
      backHref="/plan"
      backLabel="Back"
    />
  );
}
