import Link from "next/link";

export function LegalFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  return (
    <footer className="px-4 mt-5">
      <div
        className="flex items-center justify-center gap-3 text-ink3"
        style={{ fontSize: 12 }}
      >
        <Link
          href="/privacy"
          className="transition hover:text-ink2"
        >
          Privacy
        </Link>
        <span>·</span>
        <Link
          href="/terms"
          className="transition hover:text-ink2"
        >
          Terms
        </Link>
        <span>·</span>
        <span className="font-mono" style={{ fontWeight: 700 }}>
          v{version}
        </span>
      </div>
    </footer>
  );
}
