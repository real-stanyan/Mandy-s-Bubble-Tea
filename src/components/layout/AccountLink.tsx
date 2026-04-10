"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Header account link that swaps label based on whether the visitor
// has a phone saved in localStorage. We treat the presence of
// `mbt:account:phone` as "signed in" — Square is still the source of
// truth, this is purely a UX hint to show "My Account" vs "Sign in".
//
// Both states link to the same /account page; the account page itself
// handles the phone-based lookup flow.

const STORAGE_KEY = "mbt:account:phone";

export function AccountLink({ className, style }: { className?: string; style?: React.CSSProperties }) {
  // Start both server and first-client render as null so the DOM
  // matches. After mount we read localStorage and swap the label.
  // A short flash of the default label is fine — the alternative is
  // suppressHydrationWarning which hides real bugs too.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const phone = window.localStorage.getItem(STORAGE_KEY);
      setSignedIn(Boolean(phone));
    } catch {
      setSignedIn(false);
    }
  }, []);

  // Pre-hydration label — neutral so nothing jumps visually. After
  // hydration we show "Sign in" or "My Account".
  const label =
    signedIn === null ? "Account" : signedIn ? "My Account" : "Sign in";

  return (
    <Link href="/account" className={className} style={style}>
      {label}
    </Link>
  );
}
