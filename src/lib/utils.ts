// Square returns all money amounts as BigInt cents. These helpers convert
// between dollars and cents, format for display, and make Square responses
// safe to return via JSON (BigInt is not JSON-serializable by default).

/** Convert a dollar amount to Square's BigInt cents representation. */
export function toCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

/** Convert Square's BigInt cents to a dollar number for display logic. */
export function toDollars(cents: bigint | number | null | undefined): number {
  if (cents == null) return 0;
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return n / 100;
}

/** Format a BigInt cents value as an AUD price string. */
export function formatPrice(cents: bigint | number | null | undefined): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(toDollars(cents));
}

/**
 * Make a Square API response safe to send through JSON.stringify by
 * recursively converting BigInts to strings. Use this on any Square payload
 * that crosses a network boundary (e.g. route handler responses).
 */
export function serializeSquareResponse<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
