export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center bg-white px-4 text-center">
      <h1 className="text-xl font-bold">This link has expired or doesn&apos;t exist</h1>
      <p className="mt-2 text-stone-600">Please check the link, or ask the business that shared it.</p>
    </main>
  );
}
