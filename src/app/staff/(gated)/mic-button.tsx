"use client";

// The microphone, drawn once.
//
// Two pages listen now — asking for help and counting stock — and a control
// this important should not be two hand-copied versions that drift. Sizes and
// colours are pinned by controls.test.ts against this file.

export function MicButton({
  listening,
  onClick,
  idleLabel,
  busyLabel,
}: {
  listening: boolean;
  onClick: () => void;
  idleLabel: string;
  busyLabel: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={listening ? "Stop listening" : "Speak"}
        aria-pressed={listening}
        // Filled in both states. An outlined blue mic on the shop's dark page
        // measured 3.5:1 — legible, but this is the control the page is for,
        // and white on the fill is 4.59:1.
        className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-[#3579B8] text-white transition-transform active:scale-95 ${
          listening ? "" : "shadow-lg"
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
