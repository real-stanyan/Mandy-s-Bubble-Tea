// Apple logo mark used in the Add-to-Wallet CTA. lucide-react has no
// Apple glyph — this is a minimal inline path, 14px default.

type AppleLogoIconProps = {
  size?: number;
  className?: string;
};

export function AppleLogoIcon({ size = 14, className }: AppleLogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.564 12.875c-.024-2.401 1.962-3.557 2.052-3.612-1.119-1.636-2.86-1.86-3.481-1.885-1.483-.15-2.893.875-3.645.875-.752 0-1.913-.853-3.145-.83-1.618.023-3.113.941-3.947 2.391-1.682 2.917-.43 7.237 1.21 9.605.803 1.159 1.762 2.459 3.014 2.412 1.208-.05 1.666-.783 3.128-.783 1.462 0 1.875.783 3.15.76 1.3-.024 2.125-1.18 2.921-2.344.921-1.345 1.302-2.648 1.326-2.715-.029-.013-2.545-.977-2.583-3.874zM15.132 5.82c.668-.81 1.12-1.932.996-3.048-.964.04-2.13.642-2.82 1.45-.618.717-1.16 1.863-1.014 2.956 1.074.083 2.17-.548 2.838-1.358z" />
    </svg>
  );
}
