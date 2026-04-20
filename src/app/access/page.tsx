import type { Metadata } from "next";
import { AccessForm } from "./AccessForm";

export const metadata: Metadata = {
  title: "Coming Soon",
  robots: { index: false, follow: false },
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center px-6 py-16 bg-[#F9F6EE] overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#C43A10]/10 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -bottom-40 -right-32 w-[28rem] h-[28rem] rounded-full bg-[#F5E6C8] blur-3xl pointer-events-none"
      />

      <div className="relative w-full max-w-md flex flex-col items-center text-center">
        <p className="text-[#C43A10] font-mono tracking-[0.35em] text-[11px] mb-6">
          MANDY&apos;S BUBBLE TEA
        </p>

        <h1 className="text-[64px] sm:text-[80px] leading-[0.95] font-light tracking-tight text-neutral-900 mb-6"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
          Coming<br />Soon
        </h1>

        <p className="text-neutral-600 text-base sm:text-lg mb-10 max-w-sm">
          We&apos;re brewing something sweet. Back soon — or drop the password if you&apos;re on the inside.
        </p>

        <AccessForm returnTo={from ?? "/"} />

        <p className="mt-10 text-xs text-neutral-400 font-mono tracking-widest">
          34 DAVENPORT ST · SOUTHPORT QLD
        </p>
      </div>
    </main>
  );
}
