// Nine bubble-tea cups rendered inline as SVG — used in LoyaltyCard to
// show stars collected toward the current reward. `value` cups are
// filled with peach; the rest show a faint outline.
//
// Shape mirrors the RN app's brand/StarCupsRow.tsx — simplified cup
// silhouette that reads well even at 22px wide.

type StarCupsRowProps = {
  value: number;
  total: number;
  className?: string;
};

export function StarCupsRow({ value, total, className }: StarCupsRowProps) {
  const filled = Math.max(0, Math.min(value, total));

  return (
    <div
      className={
        "mt-[18px] flex justify-between gap-1 " + (className ?? "")
      }
      aria-label={`${filled} of ${total} stars`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <Cup key={i} filled={i < filled} />
      ))}
    </div>
  );
}

function Cup({ filled }: { filled: boolean }) {
  return (
    <svg
      width="22"
      height="26"
      viewBox="0 0 22 26"
      fill="none"
      aria-hidden="true"
    >
      {/* Lid */}
      <path
        d="M3 4 H19 L18 7 H4 Z"
        fill={filled ? "#FFB380" : "none"}
        stroke={filled ? "#FFB380" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Body */}
      <path
        d="M4 8 L5 22 Q5 24 7 24 H15 Q17 24 17 22 L18 8 Z"
        fill={filled ? "#FFB380" : "none"}
        stroke={filled ? "#FFB380" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Straw */}
      <path
        d="M11 2 L11 7"
        stroke={filled ? "#FFF3DE" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
