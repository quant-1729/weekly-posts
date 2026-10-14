import { isDevToolsEnabled } from "@/lib/env";
import { s } from "@/lib/i18n/strings";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-5 py-8 md:max-w-[560px]">
      <div className="md:rounded-2xl md:border md:border-stone-200 md:bg-white md:p-10 md:shadow-sm">
      <h1 className="mb-1 text-2xl font-bold text-[#E4572E]">{s.appName}</h1>
      <p className="mb-6 text-stone-600">{s.login.title}</p>
      <LoginForm showDevLink={isDevToolsEnabled()} />
      </div>
    </main>
  );
}
