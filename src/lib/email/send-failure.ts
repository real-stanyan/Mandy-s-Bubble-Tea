import type { ErrorResponse } from "resend";

// Resend reports a failure two different ways: as an `error` field on a
// resolved response, or as a thrown exception (network, bad JSON). Both end up
// here so the rest of the app only ever deals with one string.
//
// The string keeps `name` and `statusCode`, not just `message`. Those two are
// what separate "the key can't send from this domain" from "the domain isn't
// verified" from "you hit the rate limit" — the message alone is often the
// same generic sentence for all three.

function isResendError(err: unknown): err is ErrorResponse {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as Record<string, unknown>;
  // `statusCode` is what tells a Resend ErrorResponse apart from a plain
  // thrown Error — an Error also has string `message` and `name`.
  return (
    typeof candidate.message === "string" &&
    typeof candidate.name === "string" &&
    "statusCode" in candidate
  );
}

export function describeSendFailure(err: unknown): string {
  if (isResendError(err)) {
    const status =
      typeof err.statusCode === "number" ? ` ${err.statusCode}` : "";
    return `${err.name}${status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  const described = String(err);
  return described === "" ? "Unknown error." : described;
}
