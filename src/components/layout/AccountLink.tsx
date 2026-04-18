"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";

export function AccountLink({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { profile, loading } = useAuth();
  const label = loading ? "Account" : profile ? "My Account" : "Sign in";

  return (
    <Link href="/account" className={className} style={style}>
      {label}
    </Link>
  );
}
