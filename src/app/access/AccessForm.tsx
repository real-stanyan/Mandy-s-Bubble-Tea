"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function safeReturnPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export function AccessForm({ returnTo }: { returnTo: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/site-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Wrong password" : "Something went wrong");
        setPending(false);
        return;
      }
      const target = safeReturnPath(returnTo);
      router.replace(target);
      router.refresh();
    } catch {
      setError("Network error");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full flex flex-col gap-3">
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label="Site password"
        className="w-full rounded-full border border-neutral-300 px-5 py-3.5 bg-white text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-[#C43A10] focus:ring-4 focus:ring-[#C43A10]/15 transition"
      />
      <button
        type="submit"
        disabled={pending || !password}
        className="w-full rounded-full bg-[#C43A10] text-white py-3.5 font-medium tracking-wide disabled:opacity-50 hover:bg-[#A8300D] transition"
      >
        {pending ? "Checking…" : "Enter"}
      </button>
      <p
        className="text-red-600 text-sm min-h-5"
        role="alert"
        aria-live="polite"
      >
        {error ?? "\u00A0"}
      </p>
    </form>
  );
}
