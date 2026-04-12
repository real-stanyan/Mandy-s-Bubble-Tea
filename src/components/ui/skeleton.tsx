import type { ComponentProps } from "react";

export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`animate-pulse rounded-md bg-zinc-200 ${className}`}
      {...props}
    />
  );
}
