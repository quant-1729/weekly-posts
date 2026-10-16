export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-dialog text-title">This link has expired or doesn&apos;t exist</h1>
      <p className="mt-2 text-[14px] leading-5 text-desc">Please check the link, or ask the business that shared it.</p>
    </main>
  );
}
