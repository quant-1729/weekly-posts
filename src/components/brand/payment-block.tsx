import { isPaymentOwner, listPaymentIds } from "@/lib/payments";
import { qrSvg } from "@/lib/qr/encode";
import { buildPaymentUri, schemesForCountry } from "@/lib/qr/payment";
import { getSettings } from "@/lib/memory/settings";
import { PaymentCard, type PaymentPreview } from "./payment-card";

/** Server component: loads the brand's payment IDs and hands them to the "Payment QR code" card. */
export async function PaymentBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const [settings, items, isOwner] = await Promise.all([getSettings(userId, brandId), listPaymentIds(userId, brandId), isPaymentOwner(userId, brandId)]);
  const supported = schemesForCountry(settings.form.country).length > 0;
  const active = items.find((p) => p.status === "active");
  let preview: PaymentPreview | null = null;
  if (active) {
    preview = {
      svg: qrSvg(buildPaymentUri(active.scheme, { address: active.address, payeeName: active.payeeName }), { sizePx: 168 }),
      address: active.address,
      payeeName: active.payeeName,
    };
  }
  return <PaymentCard brandId={brandId} supported={supported} isOwner={isOwner} items={items} preview={preview} />;
}
