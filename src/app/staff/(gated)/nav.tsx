"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@/lib/staff/auth";

// Roster is owner-only, so staff don't see the link at all. Hiding it is
// cosmetic — the page itself checks the role — but a link that 404s for most
// of the shop is just a support question waiting to happen.

export function StaffNav({ role }: { role: StaffRole }) {
  const pathname = usePathname();
  const links = [
    { href: "/staff", label: "Stock check" },
    { href: "/staff/help", label: "Ask for help" },
    ...(role === "owner"
      ? [
          { href: "/staff/inventory", label: "Inventory" },
          { href: "/staff/roster", label: "Roster" },
        ]
      : []),
  ];

  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800">
      <ul className="mx-auto flex max-w-6xl items-center gap-1 px-4">
        {links.map((l) => {
          const active =
            l.href === "/staff" ? pathname === "/staff" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                className={`inline-block border-b-2 px-3 py-3 text-sm font-medium ${
                  active
                    ? "border-[#3B82C4] text-[#3B82C4]"
                    : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
        <li className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          <span>{role === "owner" ? "owner" : "staff"}</span>
          {/* A form, not a link: signing out clears a cookie, and a GET that
              mutates would let a prefetch or a crawler log people out. */}
          <form action="/staff/logout" method="post">
            <button type="submit" className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
              sign out
            </button>
          </form>
        </li>
      </ul>
    </nav>
  );
}
