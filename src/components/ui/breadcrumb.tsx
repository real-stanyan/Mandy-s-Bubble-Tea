import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" {...props} />;
}

export function BreadcrumbList({
  className = "",
  ...props
}: ComponentProps<"ol">) {
  return (
    <ol
      className={`flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 sm:gap-2 sm:text-sm ${className}`}
      {...props}
    />
  );
}

export function BreadcrumbItem({
  className = "",
  ...props
}: ComponentProps<"li">) {
  return (
    <li
      className={`inline-flex items-center gap-1.5 ${className}`}
      {...props}
    />
  );
}

export function BreadcrumbLink({
  className = "",
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  return (
    <Link
      href={href}
      className={`transition-colors hover:text-zinc-900 hover:underline ${className}`}
      {...props}
    />
  );
}

export function BreadcrumbPage({
  className = "",
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={`truncate font-medium text-zinc-900 ${className}`}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  children,
  className = "",
  ...props
}: { children?: ReactNode } & ComponentProps<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={`text-zinc-400 ${className}`}
      {...props}
    >
      {children ?? "/"}
    </li>
  );
}
