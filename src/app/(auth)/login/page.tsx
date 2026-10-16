import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { getCurrentUser } from "@/lib/auth";
import { isDevToolsEnabled } from "@/lib/env";
import { s } from "@/lib/i18n/strings";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in (and the session is still valid in the database): go to the dispatcher.
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthCard>
      <h1 className="mb-6 mt-6 text-dialog text-title">{s.login.title}</h1>
      <LoginForm showDevLink={isDevToolsEnabled()} />
    </AuthCard>
  );
}
