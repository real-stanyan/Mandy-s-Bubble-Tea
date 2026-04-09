// Normalize Australian phone numbers to E.164 for Square API consistency.
// Square's exact-match phone search requires E.164 format, so we funnel
// everything through here before hitting the API.

export function normalizeAuPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) {
    // Already E.164-ish; accept if it looks like a plausible length.
    return digits.length >= 8 ? digits : null;
  }

  // Local AU format: 04xx xxx xxx or 02/03/07/08 area codes.
  // Drop a leading 0, prepend +61.
  if (digits.startsWith("0")) {
    return `+61${digits.slice(1)}`;
  }

  // Bare number — assume AU if reasonable length.
  if (digits.length >= 9 && digits.length <= 11) {
    return `+61${digits}`;
  }

  return null;
}
