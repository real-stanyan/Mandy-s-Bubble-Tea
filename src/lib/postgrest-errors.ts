/**
 * "This table does not exist yet" arrives under two different codes.
 *
 * Postgres raises `42P01` (undefined_table), but PostgREST 12+ answers a
 * relation it cannot find in its own schema cache without ever asking
 * Postgres — that comes back as `PGRST205`. Production is on a PostgREST
 * that does the latter, so code checking only `42P01` never fires.
 *
 * This matters because migrations here are applied by hand in the Supabase
 * dashboard (see scripts/migrations/README.md): a deploy routinely lands
 * before its table exists, and features have to say so rather than behave
 * as if the table were merely empty.
 */
export function isMissingTableError(
  error: { code?: string | null; message?: string } | null | undefined,
): boolean {
  const code = error?.code;
  return code === "42P01" || code === "PGRST205";
}
