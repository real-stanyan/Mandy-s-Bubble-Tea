"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDigit,
  applyEdit,
  displayValue,
  normalise,
  pressBackspace,
  pressDot,
  type Entry,
} from "@/lib/staff/keypad-value";

// A keypad for entering counts, in a sheet over the list.
//
// It stays open and walks the list. Closing after every item cost three taps
// each — open the row, tap the number, tap Done — plus finding the next row and
// sitting through two sheet animations, sixty-three times over. Now it is two
// taps in fixed positions: the number, then Next. Nothing moves between items,
// so the count becomes one rhythm instead of sixty-three separate
// interactions.
//
// Still a sheet rather than inline keypads on every row: sixty-three live
// keypads would be a wall of buttons, and only one item is counted at a time.

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

export function CountKeypadSheet({
  title,
  hint,
  value,
  previous,
  previousLabel,
  index,
  total,
  onCommit,
  onMove,
  onClose,
}: {
  title: string;
  hint?: string;
  value: string;
  /** Last count for this item, shown beside the entry as a sanity check. */
  previous?: string | null;
  previousLabel?: string | null;
  /** 0-based position in the full item list, for the progress line. */
  index: number;
  total: number;
  onCommit: (next: string) => void;
  /** Move by ±1. The parent decides what happens at either end. */
  onMove: (delta: 1 | -1) => void;
  onClose: () => void;
}) {
  // The entry lives in a ref and is mirrored into state only for rendering.
  //
  // Taps arrive faster than React re-renders. Reading the current entry from
  // state meant a keystroke and the Next that followed it in the same batch
  // both saw the pre-tap value: "24" collapsed to "4", and tapping a number
  // then immediately Next committed the previous item's figure. A ref is
  // updated synchronously, so every handler sees what was actually tapped.
  const initial = value.trim();
  const ref = useRef<Entry>({ entry: initial, fresh: true });
  const [entry, setEntry] = useState(initial);
  // Only the exit is state-driven; the entrance is a CSS animation on a sheet
  // that already renders in place (see .staff-sheet in globals.css).
  const [leaving, setLeaving] = useState(false);

  const apply = useCallback((next: Entry) => {
    ref.current = next;
    setEntry(next.entry);
  }, []);

  const digit = useCallback((d: string) => apply(applyDigit(ref.current, d)), [apply]);

  const edit = useCallback(
    (fn: (v: string) => string) => apply(applyEdit(ref.current, fn)),
    [apply],
  );

  const move = useCallback(
    (delta: 1 | -1) => {
      onCommit(normalise(ref.current.entry));
      onMove(delta);
    },
    [onCommit, onMove],
  );

  const dismiss = useCallback(() => {
    setLeaving(true);
    // Matches the exit duration in CSS: committing after it means the number
    // in the row does not change while the sheet is still on top of it.
    const committed = normalise(ref.current.entry);
    setTimeout(() => {
      onCommit(committed);
      onClose();
    }, 180);
  }, [onCommit, onClose]);

  const isLast = index >= total - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A physical keyboard should just work — this gets used on a laptop as
      // well as behind the counter.
      if (e.key === "Escape") return dismiss();
      if (e.key === "Enter") return isLast ? dismiss() : move(1);
      if (/^[0-9]$/.test(e.key)) return digit(e.key);
      if (e.key === "." || e.key === ",") return edit(pressDot);
      if (e.key === "Backspace") return edit(pressBackspace);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, digit, edit, move, isLast]);

  const key =
    "flex h-14 items-center justify-center rounded-xl border text-2xl font-medium tabular-nums active:scale-[0.97] active:bg-zinc-100 dark:active:bg-zinc-800";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={dismiss}
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
            onClick={dismiss}
            className="rounded px-2 py-1 text-sm text-zinc-500 active:scale-[0.97] dark:text-zinc-400"
          >
            Close
          </button>
          <div className="min-w-0 px-2 text-center">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {hint ? `${hint} · ` : ""}
              {index + 1}/{total}
            </div>
          </div>
          <button
            onClick={() => {
              // Skip leaves it blank on purpose: "didn't check it" is a real
              // answer, and it must not become a counted zero.
              onCommit("");
              onMove(1);
            }}
            className="rounded px-2 py-1 text-sm text-zinc-500 active:scale-[0.97] dark:text-zinc-400"
          >
            Skip
          </button>
        </div>

        {/* What's been tapped so far, big enough to read at arm's length while
            holding a bottle in the other hand. */}
        <div className="px-4 pt-3 text-center text-4xl font-semibold tabular-nums">
          {displayValue(entry)}
        </div>
        {/* The last count, small and underneath — a sanity check on the number
            being typed, deliberately not pre-filled into the entry. Seeing
            "was 12" while tapping 1 is what catches a dropped digit; starting
            at 12 would just get submitted unchanged. */}
        <div className="h-5 px-4 pb-1 text-center text-xs tabular-nums text-zinc-400">
          {previous != null
            ? `was ${previous}${previousLabel ? ` ${previousLabel}` : ""}`
            : ""}
        </div>

        <div className="mx-auto grid max-w-xs grid-cols-3 gap-2 px-4">
          {KEYS.map((k) => (
            <button key={k} onClick={() => digit(k)} className={key}>
              {k}
            </button>
          ))}
          <button onClick={() => edit(pressDot)} className={key}>
            .
          </button>
          <button onClick={() => digit("0")} className={key}>
            0
          </button>
          <button
            onClick={() => edit(pressBackspace)}
            aria-label="Backspace"
            className={key}
          >
            ⌫
          </button>
        </div>

        {/* Next carries the rhythm of the whole count, so it gets the width and
            the thumb position. Back exists but stays small — going back is the
            rare case. */}
        <div className="mx-auto flex max-w-xs items-stretch gap-2 px-4 py-4">
          <button
            onClick={() => move(-1)}
            disabled={index === 0}
            aria-label="Previous item"
            className="flex h-14 w-14 items-center justify-center rounded-xl border text-xl active:scale-[0.97] disabled:opacity-30"
          >
            ←
          </button>
          <button
            onClick={() => (isLast ? dismiss() : move(1))}
            className="h-14 flex-1 rounded-xl bg-[#3B82C4] text-lg font-semibold text-white active:scale-[0.98]"
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
