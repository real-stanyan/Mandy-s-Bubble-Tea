// Pure formatting/validation helpers shared by the auth UI (AuthForm,
// SignInCard) and the complete-signup route. Kept side-effect free so
// they unit-test without React or Supabase.

/**
 * Normalize a user-typed AU phone number to E.164 (`+61...`).
 * Returns null when the input can't be a valid number.
 *
 * - leading `+` → trusted as already-international (min 8 chars)
 * - leading `0` → local AU number, swap for `+61`
 * - bare 9–11 digits → assume AU national, prefix `+61`
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  if (digits.length >= 9 && digits.length <= 11) return `+61${digits}`;
  return null;
}

/**
 * `digits.length >= 9` per the design spec — matches the prototype's
 * `phoneValid` check (the +61 prefix is rendered separately so the user
 * types the national part).
 */
export function isPhoneValid(raw: string): boolean {
  return raw.replace(/\D/g, "").length >= 9;
}

/**
 * Pretty-print a phone for the "We texted a code to …" line:
 * `+61 ### ### ###`. Accepts either E.164 (`+61404978238`), a local
 * number (`0404978238`), or already-grouped input. Falls back to the
 * raw string if it doesn't look like an AU mobile.
 */
export function prettyPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("61")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 9) return input;
  const grouped = digits.replace(/(\d{3})(\d{3})(\d{0,3}).*/, "$1 $2 $3").trim();
  return `+61 ${grouped}`;
}

/**
 * Split a single "Full name" field into first / last for the Square
 * customer record. First whitespace-delimited word is the first name;
 * the remainder (if any) is the last name.
 */
export function splitFullName(full: string): {
  firstName: string;
  lastName?: string;
} {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || undefined,
  };
}

/**
 * Trim + lowercase an email and do a light structural check. Returns
 * null for empty/invalid input so callers can treat "no email" and
 * "bad email" the same way (the field is optional on the backend).
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Deliberately permissive — one @, a dot in the domain, no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}
