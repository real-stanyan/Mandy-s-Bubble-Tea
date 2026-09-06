"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { nearestIndex } from "@/lib/menu/option-axis";

// Sugar and ice as a slider: one pill on a track of ticks. Click a tick or
// drag the pill; it follows the pointer and snaps to the nearest tick on
// release. Disabled ticks (Warm while cheese cream is on) are dimmed and
// skipped, and say why when you land on them. Same control as the App's
// components/menu/OptionSlider.tsx.

export type SliderOption = {
  id: string;
  /** Tick label ("50%", "Less"). */
  short: string;
  /** Full name, read out and shown under the track ("Half Sugar"). */
  name: string;
  disabled?: boolean;
  /** Why it is off — shown under the track when it is landed on. */
  disabledReason?: string | null;
};

type Props = {
  label: string;
  options: SliderOption[];
  value: string | null;
  onChange: (id: string) => void;
};

const PAD = 4;
const NOTE_MS = 2600;
const DRAG_THRESHOLD = 4;

export function OptionSlider({ label, options, value, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);
  const count = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  // Tick width follows the track; the pill is one tick wide.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || count === 0) return;
    const measure = () => setCell((el.clientWidth - PAD * 2) / count);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explain = useCallback((reason: string) => {
    setNote(reason);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  const select = useCallback(
    (index: number, rawIndex?: number) => {
      if (rawIndex != null && rawIndex !== index) {
        const skipped = options[rawIndex];
        if (skipped?.disabled) explain(skipped.disabledReason ?? "Unavailable");
      }
      const o = options[index];
      if (o && !o.disabled && o.id !== value) onChange(o.id);
    },
    [options, value, onChange, explain],
  );

  // Drag: the pill follows the pointer; ticks stay clickable for a plain tap.
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startPill: number; moved: boolean } | null>(null);
  // The click that follows a drag's pointerup must not re-select the tick under the pointer.
  const justDragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || cell === 0) return;
    drag.current = { startX: e.clientX, startPill: selectedIndex * cell, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      // Capture so the drag survives leaving the track; some pointers (and
      // synthetic events) cannot be captured — the drag still works without.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    }
    const max = (count - 1) * cell;
    setDragX(Math.min(max, Math.max(0, d.startPill + dx)));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const x = dragX ?? d.startPill;
    setDragX(null);
    const pos = x / Math.max(1, cell);
    const raw = Math.min(count - 1, Math.max(0, Math.round(pos)));
    const idx = nearestIndex(
      pos,
      count,
      options.map((o) => !!o.disabled),
    );
    select(idx, raw);
  };

  const pillX = dragX ?? selectedIndex * cell;
  const current = options[selectedIndex];

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        role="radiogroup"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative flex h-11 select-none items-stretch rounded-full border border-line bg-bg p-1 touch-pan-y"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1 top-1 h-[34px] rounded-full border border-line bg-card shadow-[0_2px_8px_rgba(42,30,20,0.08)]"
          style={{
            width: cell,
            transform: `translateX(${pillX}px) scale(${dragX != null ? 1.04 : 1})`,
            transition: dragX != null ? "none" : "transform 400ms cubic-bezier(0.16, 1, 0.3, 1)",
            opacity: cell > 0 ? 1 : 0,
          }}
        />
        {options.map((o, i) => {
          const selected = i === selectedIndex;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={o.name}
              aria-disabled={!!o.disabled}
              onClick={() => {
                if (justDragged.current) return;
                if (o.disabled) {
                  explain(o.disabledReason ?? "Unavailable");
                  return;
                }
                if (!selected) onChange(o.id);
              }}
              className={
                "relative z-[1] flex flex-1 items-center justify-center truncate px-1 text-[12.5px] transition-colors " +
                (selected ? "font-semibold text-ink" : o.disabled ? "text-ink4" : "font-medium text-ink3")
              }
            >
              {o.short}
            </button>
          );
        })}
      </div>
      <p
        aria-live="polite"
        className={"ml-1.5 mt-2 truncate text-[12.5px] " + (note ? "font-semibold text-brand" : "font-medium text-ink3")}
      >
        {note ?? current?.name ?? ""}
      </p>
    </div>
  );
}
