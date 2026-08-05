"use client";
import { useCallback, useEffect, useState } from "react";
import {
  displayValue,
  normalise,
  pressBackspace,
  pressDigit,
  pressDot,
} from "@/lib/staff/keypad-value";

// A keypad for entering a count, in a sheet over the list.
//
// It replaced a two-drum alarm-clock picker. The drum got one thing right —
// keeping the OS keyboard from sliding over sixty-three rows mid-count — and
// one thing wrong: spinning is the wrong motion for these numbers. Counts here
// are nearly always a single digit, and reaching 24 meant flicking past
// twenty-three others. Tapping is one action for the common case and three for
// "0.5", with the keyboard still off the screen.
//
// It stays a sheet rather than going inline: sixty-three live keypads would be
// a wall of buttons, and only one item is counted at a time anyway.

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

export function CountKeypadSheet({
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
  const [entry, setEntry] = useState(() => value.trim());
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
      if (e.key === "Escape") return dismiss(null);
      if (e.key === "Enter") return dismiss(normalise(entry));
      // A physical keyboard should just work — this is used on a laptop as
      // well as behind the counter.
      if (/^[0-9]$/.test(e.key)) return setEntry((v) => pressDigit(v, e.key));
      if (e.key === "." || e.key === ",") return setEntry(pressDot);
      if (e.key === "Backspace") return setEntry(pressBackspace);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, entry]);

  const key =
    "flex h-14 items-center justify-center rounded-xl border text-2xl font-medium tabular-nums active:scale-[0.97] active:bg-zinc-100 dark:active:bg-zinc-800";

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
            className="rounded px-2 py-1 text-sm text-zinc-500 active:scale-[0.97] dark:text-zinc-400"
          >
            Clear
          </button>
          <div className="min-w-0 px-2 text-center">
            <div className="truncate text-sm font-semibold">{title}</div>
            {hint && (
              <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {hint}
              </div>
            )}
          </div>
          <button
            onClick={() => dismiss(normalise(entry))}
            className="rounded px-2 py-1 text-sm font-semibold text-[#3B82C4] active:scale-[0.97]"
          >
            Done
          </button>
        </div>

        {/* What's been tapped so far, big enough to read at arm's length while
            holding a bottle in the other hand. */}
        <div className="px-4 py-3 text-center text-4xl font-semibold tabular-nums">
          {displayValue(entry)}
        </div>

        <div className="mx-auto grid max-w-xs grid-cols-3 gap-2 px-4 pb-4">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setEntry((v) => pressDigit(v, k))}
              className={key}
            >
              {k}
            </button>
          ))}
          <button onClick={() => setEntry(pressDot)} className={key}>
            .
          </button>
          <button onClick={() => setEntry((v) => pressDigit(v, "0"))} className={key}>
            0
          </button>
          <button
            onClick={() => setEntry(pressBackspace)}
            aria-label="Backspace"
            className={key}
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
