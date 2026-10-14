import { getAllWorkItems, getMascot, getPlansConfig, getPlansCopy, getPublishedWork, getSite, getSystem } from "@/lib/content";
import { priceLineText } from "@/components/sections/PlanParts";
import { isPreview } from "@/lib/mode";
import type { TweenBundle } from "./types";

/** Server-side: the written copy plus the exact price lines the Plans page shows. Nothing here is personal or invented. */
export function buildBundle(): TweenBundle {
  const mascot = getMascot();
  const plans = getPlansConfig();
  const copy = getPlansCopy();
  const lines: string[] = [];
  if (plans.priceDisplay !== "hidden") {
    const saas = plans.segments.saas;
    const pilot = priceLineText({ price: saas.pilot.price, currency: plans.currency, mode: plans.priceDisplay, kind: "pilot", lines: copy.priceLines });
    if (pilot) lines.push(`${saas.pilot.name}: ${pilot}`);
    for (const p of saas.monthly) {
      const t = priceLineText({ price: p.price, currency: plans.currency, mode: plans.priceDisplay, kind: "monthly", lines: copy.priceLines });
      if (t) lines.push(`${p.name}: ${t}`);
    }
  }
  const hasWork = getPublishedWork().length > 0;
  void getAllWorkItems;
  return {
    mascot,
    form: getSystem().form,
    email: getSite().email,
    sla: getSite().sla.responseText,
    facts: { priceMode: plans.priceDisplay, priceLines: lines, hasWork, hasSlots: !hasWork && isPreview() },
  };
}
