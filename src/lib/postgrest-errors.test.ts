import { describe, it, expect } from "vitest";
import { isMissingTableError } from "./postgrest-errors";

describe("isMissingTableError", () => {
  it("matches the PostgREST schema-cache miss production actually returns", () => {
    // Verbatim from a service-role select against a table that had not been
    // created yet — PostgREST answers this itself, Postgres is never asked.
    expect(
      isMissingTableError({
        code: "PGRST205",
        message: "Could not find the table 'public.loyalty_push_runs' in the schema cache",
      }),
    ).toBe(true);
  });

  it("matches Postgres' own undefined_table", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
  });

  it("does not match an empty table or an unrelated failure", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError({ code: null })).toBe(false);
    // Permission denied is not "run the migration" — the table is there.
    expect(isMissingTableError({ code: "42501" })).toBe(false);
  });
});
