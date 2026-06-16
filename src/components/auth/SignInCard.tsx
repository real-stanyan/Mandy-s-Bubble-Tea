"use client";

import { AuthForm } from "@/components/auth/AuthForm";

// Compact single-column sign-in surface (warm card). Used on Checkout
// and the Orders page, and as the narrow-viewport form everywhere. The
// account page uses <AuthSplitCard> for the desktop two-panel layout.
//
// All auth logic + the redesigned join/sign-in + OTP UI live in
// <AuthForm>; this is just the card chrome around it. `heading` /
// `subheading` override AuthForm's mode-derived copy (e.g. Checkout's
// "Sign in to check out").
export function SignInCard({
  heading,
  subheading,
  onComplete,
}: {
  heading?: string;
  subheading?: string;
  onComplete?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md rounded-card border border-line bg-card p-6 shadow-[0_2px_8px_rgba(42,30,20,0.05)] sm:p-8">
      <AuthForm
        variant="card"
        headingOverride={heading}
        subheadingOverride={subheading}
        onComplete={onComplete}
      />
    </div>
  );
}
