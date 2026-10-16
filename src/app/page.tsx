import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homePathFor } from "@/lib/auth/home";

// Dispatcher: signed out -> /login, no finished brand yet -> /setup, otherwise /home.
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(await homePathFor(user.id));
}
