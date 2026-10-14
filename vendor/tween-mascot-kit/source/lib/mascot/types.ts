import type { MascotContent, SystemCopy } from "@/lib/content-schema";
import type { Facts } from "./dialogue";

/** What /api/mascot serves and the lazy Tween chunk consumes: written copy plus build-time facts. No personal data. */
export type TweenBundle = {
  mascot: MascotContent;
  form: SystemCopy["form"];
  email: string;
  sla: string;
  facts: Facts;
};
