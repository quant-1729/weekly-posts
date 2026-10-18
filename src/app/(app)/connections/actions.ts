"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { isDemoUser } from "@/lib/demo";
import { getCurrentBrand } from "@/lib/brand/current";
import { FB_PENDING_COOKIE } from "@/lib/connections/facebook";
import { choosePage } from "@/lib/connections/oauth";
import { disconnectChannel } from "@/lib/connections/service";
import { ConnectionError } from "@/lib/connections/types";
import { PROVIDERS, type Provider } from "@/lib/queue/types";

/** "Disconnect" on a card. Owner only (checked in disconnectChannel and again by the database). */
export async function disconnectAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (isDemoUser(user)) redirect("/connections?connect_error=demo");
  const brand = await getCurrentBrand(user.id);
  if (!brand) redirect("/setup");
  const provider = String(formData.get("provider") ?? "");
  if (!(PROVIDERS as readonly string[]).includes(provider)) redirect("/connections");
  let error: string | null = null;
  try {
    await disconnectChannel({ userId: user.id, brandId: brand.id, provider: provider as Provider });
  } catch (e) {
    error = e instanceof ConnectionError ? e.code : "exchange_failed";
  }
  revalidatePath("/connections");
  redirect(error ? `/connections?connect_error=${error}` : `/connections?disconnected=${provider}`);
}

/** The Facebook Page picker's submit. */
export async function chooseFacebookPageAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (isDemoUser(user)) redirect("/connections?connect_error=demo");
  const store = await cookies();
  const out = await choosePage({ userId: user.id, pending: store.get(FB_PENDING_COOKIE)?.value, pageId: String(formData.get("page") ?? "") });
  if (out.ok) {
    store.delete(FB_PENDING_COOKIE);
    revalidatePath("/connections");
    redirect("/connections?connected=facebook");
  }
  redirect(`/connections?connect_error=${out.code}`);
}

/** "Cancel" on the picker: forget the waiting login. */
export async function cancelFacebookPickAction(): Promise<void> {
  const store = await cookies();
  store.delete(FB_PENDING_COOKIE);
  redirect("/connections");
}
