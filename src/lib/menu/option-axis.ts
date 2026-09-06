// Sugar and ice are one-dimensional choices — less to more, warm to cold —
// so they are laid out on a slider rather than as a bag of chips. Square
// stores them as unordered single-select lists with the shop's own names
// ("Little Sugar (25%)", "Warm"); this file turns those names into a
// position on the axis and a short tick label, and knows which lists
// qualify. Unknown names still get a slot, at the end, so a new option in
// Square shows up rather than vanishing.
//
// Mirror of the App's lib/menu/option-axis.ts (2026-09-06) — keep in step.
//
// Names verified against the production catalog on 2026-09-06:
//   SUGAR: Standard Sugar (default) · Less Sugar (75%) · Half Sugar ·
//          Little Sugar (25%) · No Sugar · Extra Sugar   (some drinks: fewer)
//   ICE:   Normal Ice (default) · Extra Ice · Less Ice · No Ice · (Warm)

export type AxisKind = "sugar" | "ice";

export type AxisOption<T> = {
  option: T;
  /** Position along the axis; sorted ascending. */
  value: number;
  /** Short tick label ("50%", "Less"). */
  short: string;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Which axis a Square modifier list belongs on, or null for chips. */
export function axisKindFor(listName: string | null | undefined): AxisKind | null {
  const n = (listName ?? "").toUpperCase();
  if (n.includes("SUGAR")) return "sugar";
  if (n.includes("ICE")) return "ice";
  return null;
}

/** 0 · 25 · 50 · 75 · 100 · 125, mirroring cup-visual's sugarFrom. */
export function sugarPercent(name: string): number | null {
  const n = norm(name);
  if (!n.includes("sugar")) return null;
  if (n.includes("extra")) return 125;
  if (n.includes("no sugar")) return 0;
  if (n.includes("25%") || n.includes("little")) return 25;
  if (n.includes("half") || n.includes("50%")) return 50;
  if (n.includes("75%") || n.includes("less")) return 75;
  return 100;
}

/** Warm sits before "no ice": the axis runs warm → cold. */
export function iceLevel(name: string): number | null {
  const n = norm(name);
  if (n === "warm" || n === "hot") return -1;
  if (!n.includes("ice")) return null;
  if (n.includes("no ice")) return 0;
  if (n.includes("less")) return 1;
  if (n.includes("extra")) return 3;
  return 2;
}

export function shortLabel(kind: AxisKind, name: string): string {
  if (kind === "sugar") {
    const p = sugarPercent(name);
    return p == null ? name : `${p}%`;
  }
  switch (iceLevel(name)) {
    case -1:
      return "Warm";
    case 0:
      return "None";
    case 1:
      return "Less";
    case 2:
      return "Normal";
    case 3:
      return "Extra";
    default:
      return name;
  }
}

/**
 * Order a list's options along the axis. Options the axis doesn't recognise
 * keep their catalog order after the known ones.
 */
export function axisOptions<T extends { name: string }>(kind: AxisKind, options: T[]): AxisOption<T>[] {
  const known: AxisOption<T>[] = [];
  const unknown: AxisOption<T>[] = [];
  options.forEach((option, i) => {
    const v = kind === "sugar" ? sugarPercent(option.name) : iceLevel(option.name);
    if (v == null) unknown.push({ option, value: 1000 + i, short: option.name });
    else known.push({ option, value: v, short: shortLabel(kind, option.name) });
  });
  known.sort((a, b) => a.value - b.value);
  return [...known, ...unknown];
}

/** Index of the option nearest to a fractional slider position (0..n-1), skipping disabled ones. */
export function nearestIndex(position: number, count: number, disabled: readonly boolean[] = []): number {
  if (count <= 0) return 0;
  const target = Math.min(count - 1, Math.max(0, Math.round(position)));
  if (!disabled[target]) return target;
  // Walk outward from the target until an enabled option is found, preferring
  // the side the pointer came from.
  for (let d = 1; d < count; d++) {
    const lo = target - d;
    const hi = target + d;
    const first = position < target ? lo : hi;
    const second = position < target ? hi : lo;
    if (first >= 0 && first < count && !disabled[first]) return first;
    if (second >= 0 && second < count && !disabled[second]) return second;
  }
  return target;
}
