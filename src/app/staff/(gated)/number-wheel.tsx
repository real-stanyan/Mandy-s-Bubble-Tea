"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_WHOLE, fromParts, toParts, type WheelParts } from "@/lib/staff/wheel-value";

// An alarm-clock drum for entering a count: whole number on the left, tenth on
// the right.
//
// It opens as a sheet rather than sitting inline in the row. Sixty-three rows
// of live drums would turn the whole page into nested scrollers — every drag
// aimed at the page would spin a wheel instead — and only one item is being
// counted at a time anyway.
//
// The spin itself is native scrolling with CSS snap points, not a hand-rolled
// gesture: momentum, rubber-banding and the feel of the flick are exactly what
// the platform already does well, and re-implementing them is how web pickers
// end up feeling wrong.

const ITEM_H = 44; // px per row on the drum
const VISIBLE = 5; // rows in the window, so the choice sits in the middle one
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;

const WHOLES = Array.from({ length: MAX_WHOLE + 1 }, (_, i) => i);
const TENTHS = Array.from({ length: 10 }, (_, i) => i);

function Drum({
  values,
  value,
  onChange,
  label,
  format,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  label: string;
  format: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Scrolling the drum to reflect a value must not be mistaken for the user
  // spinning it, or the two fight each other on the way to the same number.
  const programmatic = useRef(false);

  const scrollToValue = useCallback(
    (v: number, smooth: boolean) => {
      const el = ref.current;
      if (!el) return;
      const index = Math.max(0, values.indexOf(v));
      programmatic.current = true;
      el.scrollTo({ top: index * ITEM_H, behavior: smooth ? "smooth" : "auto" });
      // No scrollend on older Safari; a timeout is the portable release.
      setTimeout(() => {
        programmatic.current = false;
      }, smooth ? 400 : 60);
    },
    [values],
  );

  // Mount-only on purpose: after the first paint the drum is the source of
  // truth for its own position, and re-running this on every value change
  // would yank the wheel back mid-flick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => scrollToValue(value, false), []);

  function onScroll() {
    if (programmatic.current) return;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const index = Math.round(el.scrollTop / ITEM_H);
      const next = values[Math.max(0, Math.min(index, values.length - 1))];
      if (next !== value) onChange(next);
    }, 90);
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const i = values.indexOf(value);
        if (e.key === "ArrowDown" && i < values.length - 1) {
          e.preventDefault();
          onChange(values[i + 1]);
          scrollToValue(values[i + 1], true);
        }
        if (e.key === "ArrowUp" && i > 0) {
          e.preventDefault();
          onChange(values[i - 1]);
          scrollToValue(values[i - 1], true);
        }
      }}
      className="h-[220px] flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-hide text-center"
      style={{ scrollPaddingTop: PAD }}
    >
      <div style={{ paddingTop: PAD, paddingBottom: PAD }}>
        {values.map((v) => (
          <div
            key={v}
            role="option"
            aria-selected={v === value}
            onClick={() => {
              onChange(v);
              scrollToValue(v, true);
            }}
            className={`flex snap-center items-center justify-center text-2xl tabular-nums transition-opacity duration-150 ease-out ${
              // Dim, not invisible: the neighbours are what tell you which way
              // to spin, and at 40% on a black sheet they had all but gone.
              v === value ? "font-semibold opacity-100" : "opacity-60"
            }`}
            style={{ height: ITEM_H }}
          >
            {format(v)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function NumberWheelSheet({
  title,
  hint,
  value,
  onCommit,
  onClose,
}: {
  title: string;
  hint?: string;
  value: string;
  onCommit: (next: string) => void;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<WheelParts>(() => toParts(value) ?? { whole: 0, tenth: 0 });
  // Only the exit is state-driven; the entrance is a CSS animation on a sheet
  // that already renders in place (see .staff-sheet in globals.css).
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(
    (commit: string | null) => {
      setLeaving(true);
      // Matches the exit duration in CSS: committing after it means the number
      // in the row does not change while the sheet is still on top of it.
      setTimeout(() => {
        if (commit !== null) onCommit(commit);
        onClose();
      }, 180);
    },
    [onCommit, onClose],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={() => dismiss(null)}
        data-leaving={leaving}
        className="staff-scrim absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-leaving={leaving}
        className="staff-sheet relative w-full max-w-md rounded-t-2xl border-t bg-white pb-[env(safe-area-inset-bottom)] dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <button
            onClick={() => dismiss("")}
            className="rounded px-2 py-1 text-sm text-zinc-500 active:scale-[0.97]"
          >
            Clear
          </button>
          <div className="min-w-0 px-2 text-center">
            <div className="truncate text-sm font-semibold">{title}</div>
            {hint && <div className="truncate text-xs text-zinc-500">{hint}</div>}
          </div>
          <button
            onClick={() => dismiss(fromParts(parts))}
            className="rounded px-2 py-1 text-sm font-semibold text-[#3B82C4] active:scale-[0.97]"
          >
            Done
          </button>
        </div>

        <div className="relative mx-auto flex max-w-[16rem] items-stretch px-4 pb-4">
          {/* The band the chosen row sits in — the drum reads as a physical
              wheel behind a window, not a list with a highlighted item. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg bg-zinc-100 dark:bg-zinc-800"
            style={{ height: ITEM_H }}
          />
          <Drum
            values={WHOLES}
            value={parts.whole}
            onChange={(whole) => setParts((p) => ({ ...p, whole }))}
            label="whole number"
            format={(v) => String(v)}
          />
          <div className="relative z-10 flex items-center text-2xl font-semibold">.</div>
          <Drum
            values={TENTHS}
            value={parts.tenth}
            onChange={(tenth) => setParts((p) => ({ ...p, tenth }))}
            label="tenths"
            format={(v) => String(v)}
          />
        </div>
      </div>
    </div>
  );
}
