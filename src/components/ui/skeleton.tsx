import type { ComponentProps } from "react";

// Loading placeholder: token surface + a slow warm shimmer sweep
// (.mbt-shimmer, globals.css) instead of the old zinc opacity pulse.
// Tokens keep it correct in Evening Mode; the sweep reads unhurried,
// which is half of what makes waiting feel premium.
export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`mbt-shimmer rounded-md bg-bg2 ${className}`}
      {...props}
    />
  );
}
