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
  // staff-surface (globals.css) supplies the foreground and border colour this
  // subtree needs. Without it the page keeps the customer site's ink-brown
  // text, which is invisible against dark:bg-black.
  return (
    <div className="staff-surface min-h-screen bg-white dark:bg-black">{children}</div>
  );
}
