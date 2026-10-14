// What a brief's QR spec turns into when a post is drawn (phase 2 renderer) and how the drawn
// picture is checked afterwards. Server side: a payment spec reads the brand's active payment ID.

import type { QrSpec } from "@/lib/briefs/types";
import { getEnv } from "@/lib/env";
import { getActivePaymentIdById } from "@/lib/payments";
import { verifyRendered, type DecodeRegion, type VerifyResult } from "./decode";
import { linkQrContent } from "./link";
import { buildPaymentUri } from "./payment";

export type QrBlockReason = "payment_not_active" | "no_short_link" | "no_base_url";

export class QrContentError extends Error {
  constructor(public readonly reason: QrBlockReason) {
    super(`QR cannot be drawn: ${reason}`);
    this.name = "QrContentError";
  }
}

export interface QrContent {
  kind: "link" | "payment";
  /** The exact text the QR must hold. */
  text: string;
  /** Label printed under the QR ("Scan to visit" / "Scan to pay"). */
  label: "visit" | "pay";
  /** Printed as text next to a payment QR (never anywhere else). */
  payment?: { address: string; payeeName: string };
}

/**
 * The text to encode for a QR spec. A link QR needs the post's short-link code (`postCode`); a
 * payment QR needs its payment ID to be active and the brand's own, otherwise it throws
 * QrContentError("payment_not_active") and the post must be blocked.
 */
export async function qrContentFor(spec: QrSpec, args: { brandId: string; postCode?: string; baseUrl?: string }): Promise<QrContent> {
  if (spec.kind === "link") {
    if (!args.postCode) throw new QrContentError("no_short_link");
    const base = args.baseUrl ?? getEnv().appUrl;
    if (!base) throw new QrContentError("no_base_url");
    return { kind: "link", text: linkQrContent(base, args.postCode), label: "visit" };
  }
  const pay = await getActivePaymentIdById(args.brandId, spec.paymentId);
  if (!pay) throw new QrContentError("payment_not_active");
  const text = buildPaymentUri(pay.scheme, { address: pay.address, payeeName: pay.payeeName, amount: spec.amount });
  return { kind: "payment", text, label: "pay", payment: { address: pay.address, payeeName: pay.payeeName } };
}

/**
 * After rendering: decode the picture and require exactly `content.text`. For a payment QR a
 * mismatch must block the post. Pass the QR's slot as `region` to look only there.
 */
export async function verifyQrOnPost(png: Buffer, content: QrContent, region?: DecodeRegion): Promise<VerifyResult> {
  return verifyRendered(png, content.text, region);
}
