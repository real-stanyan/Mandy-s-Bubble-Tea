import type { Metadata } from "next";

// Staff-only tools, living on the customer domain but deliberately unlinked
// from it. An unlisted URL on a public domain is not protection on its own, so
// everything here is told not to be indexed, and everything except the login
// page sits behind the shared passcode — see the (gated) route group.

export const metadata: Metadata = {
  title: "Staff — Mandy's",
  robots: { index: false, follow: false, nocache: true },
};

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Colours are pinned rather than inherited. The customer site deliberately
  // stays light even when the device asks for dark, and its body text is a
  // dark brown tuned for a cream background — inheriting that into a white
  // tool UI, or leaving the `dark:` variants these components arrived with,
  // produced dark text on a black panel and nothing legible.
  return (
    <div className="min-h-screen bg-white text-zinc-900 [color-scheme:light]">
      {children}
    </div>
  );
}
