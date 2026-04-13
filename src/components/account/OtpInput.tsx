"use client";

import { useRef, useCallback, KeyboardEvent, ClipboardEvent } from "react";
import { BRAND } from "@/lib/constants";

const CODE_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const focusIndex = useCallback((i: number) => {
    inputsRef.current[i]?.focus();
  }, []);

  const handleChange = useCallback(
    (i: number, digit: string) => {
      if (!/^\d?$/.test(digit)) return;
      const chars = value.split("");
      // Pad to length so indices work.
      while (chars.length < CODE_LENGTH) chars.push("");
      chars[i] = digit;
      const next = chars.join("").slice(0, CODE_LENGTH);
      onChange(next);
      if (digit && i < CODE_LENGTH - 1) {
        focusIndex(i + 1);
      }
    },
    [value, onChange, focusIndex],
  );

  const handleKeyDown = useCallback(
    (i: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !value[i] && i > 0) {
        focusIndex(i - 1);
      }
    },
    [value, focusIndex],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, CODE_LENGTH);
      if (pasted) {
        onChange(pasted);
        focusIndex(Math.min(pasted.length, CODE_LENGTH - 1));
      }
    },
    [onChange, focusIndex],
  );

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: CODE_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          autoFocus={i === 0}
          className="h-13 w-11 rounded-lg border-2 text-center text-xl font-bold outline-none transition-colors disabled:opacity-50"
          style={{
            borderColor: error
              ? "#ef4444"
              : value[i]
                ? BRAND.primaryColor
                : "#d4d4d8",
          }}
        />
      ))}
    </div>
  );
}
