"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";

export function AccountLink({
  className,
  style,
  onClick,
}: {
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const { profile, loading } = useAuth();
  const label = loading ? "Account" : profile ? "My Account" : "Sign in";

  return (
    <Link href="/account" className={className} style={style} onClick={onClick}>
      {label}
    </Link>
  );
}
