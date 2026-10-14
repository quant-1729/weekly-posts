"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { paymentCopy } from "@/lib/payments/copy";
import { PaymentError, addPaymentId, retirePaymentId, type PaymentIdView } from "@/lib/payments";

/**
 * Server actions for the "Payment QR code" card. The ID is typed by the owner and goes straight
 * to the payments library; it never passes through AI. A new ID is saved as pending and a
 * confirmation email is sent.
 */

export type PaymentResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; field?: "address" | "payeeName" };

const errors = paymentCopy.card.errors;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function fail(e: unknown): PaymentResult<never> {
  if (e instanceof PaymentError) {
    const message = errors[e.code] ?? errors.generic;
    return { ok: false, message, field: e.code === "address" ? "address" : e.code === "payeeName" ? "payeeName" : undefined };
  }
  console.error("[payments]", e instanceof Error ? e.message : e);
  return { ok: false, message: errors.generic };
}

export async function addPaymentIdAction(brandId: string, input: { scheme: string; address: string; payeeName: string }): Promise<PaymentResult<{ payment: PaymentIdView }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: errors.generic };
  try {
    const payment = await addPaymentId({ userId: user.id, brandId: str(brandId), scheme: str(input?.scheme), address: str(input?.address), payeeName: str(input?.payeeName) });
    revalidatePath("/brand");
    return { ok: true, payment };
  } catch (e) {
    return fail(e);
  }
}

export async function retirePaymentIdAction(brandId: string, id: string): Promise<PaymentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: errors.generic };
  try {
    const done = await retirePaymentId({ userId: user.id, brandId: str(brandId), id: str(id) });
    if (!done) return { ok: false, message: errors.not_found };
    revalidatePath("/brand");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
