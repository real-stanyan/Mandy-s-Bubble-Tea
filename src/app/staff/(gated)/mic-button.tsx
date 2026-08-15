"use client";

// The microphone, drawn once.
//
// Two pages listen now — asking for help and counting stock — and a control
// this important should not be two hand-copied versions that drift. Sizes and
// colours are pinned by controls.test.ts against this file.

export function MicButton({
  listening,
  onClick,
  onHoldStart,
  onHoldEnd,
  idleLabel,
  busyLabel,
}: {
  listening: boolean;
  /** Tap to start, tap again to stop. Used where a question takes a while to
   *  compose and holding a phone up throughout would be daft. */
  onClick?: () => void;
  /** Press and hold. Counting stock is a burst per shelf, and holding is the
   *  gesture that already means "I am talking now" on a phone. */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  idleLabel: string;
  busyLabel: string;
}) {
  const hold = onHoldStart !== undefined;
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={hold ? undefined : onClick}
        // Pointer events, not touch: one set covers the finger in the shop and
        // the mouse on the till computer.
        //
        // pointerup and pointercancel both end it, and so does the pointer
        // leaving the button. A finger that slides off mid-sentence must not
        // leave the microphone open with nobody watching it.
        onPointerDown={
          hold
            ? (e) => {
                // Stops the long-press turning into a text selection or the
                // iOS callout menu, which cancels the gesture halfway.
                e.preventDefault();
                onHoldStart?.();
              }
            : undefined
        }
        onPointerUp={hold ? () => onHoldEnd?.() : undefined}
        onPointerCancel={hold ? () => onHoldEnd?.() : undefined}
        onPointerLeave={hold ? () => onHoldEnd?.() : undefined}
        onContextMenu={hold ? (e) => e.preventDefault() : undefined}
        aria-label={
          hold ? "Hold to speak" : listening ? "Stop listening" : "Speak"
        }
        aria-pressed={listening}
        // Filled in both states. An outlined blue mic on the shop's dark page
        // measured 3.5:1 — legible, but this is the control the page is for,
        // and white on the fill is 4.59:1.
        // touch-none and select-none so a press-and-hold does not scroll the
        // list underneath or start selecting the label.
        className={`relative flex h-20 w-20 touch-none select-none items-center justify-center rounded-full bg-[#3579B8] text-white transition-transform ${
          listening ? "scale-110" : "shadow-lg active:scale-95"
        }`}
      >
        {/* A drawn icon, not an emoji: the microphone glyph is a different
            picture on every platform and renders at whatever size the font
            decides, which is the opposite of something you aim at. */}
        {listening ? (
          <span className="block h-6 w-6 rounded-sm bg-current" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="h-9 w-9"
            aria-hidden="true"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        )}
        {/* The ring sits outside the button's own box so it cannot nudge the
            layout as it animates. */}
        {listening && (
          <span className="pointer-events-none absolute -inset-2 animate-ping rounded-full border-2 border-[#3579B8] opacity-60" />
        )}
      </button>
      {/* Skipped entirely when there is no caption, rather than reserving a
          blank line. The stock page floats this over the list and every
          pixel of empty backdrop there covers a row. */}
      {(idleLabel || busyLabel) && (
        <div className="mt-2 h-5 text-sm text-zinc-500">
          {listening ? busyLabel : idleLabel}
        </div>
      )}
    </div>
  );
}
