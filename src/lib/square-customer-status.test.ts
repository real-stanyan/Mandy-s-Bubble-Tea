import { describe, it, expect } from "vitest";
import { classifyDeletedCustomerResult } from "./square-customer-status";

describe("classifyDeletedCustomerResult", () => {
  const ID = "NZ94EYN08CDXAE31GEBYA857YR";

  it("treats a 404 error as a genuine deletion (safe to purge)", () => {
    expect(classifyDeletedCustomerResult(ID, undefined, { statusCode: 404 })).toEqual({
      kind: "gone",
    });
  });

  it("treats a NOT_FOUND error code as a genuine deletion", () => {
    expect(
      classifyDeletedCustomerResult(ID, undefined, {
        errors: [{ code: "NOT_FOUND" }],
      }),
    ).toEqual({ kind: "gone" });
  });

  it("treats a missing customer (no error) as gone", () => {
    expect(classifyDeletedCustomerResult(ID, null)).toEqual({ kind: "gone" });
  });

  it("flags a MERGE when GET resolves to a different surviving id", () => {
    // The real judith-hutte case: deleting id NZ94… redirects to 1JH4…
    expect(
      classifyDeletedCustomerResult(ID, { id: "1JH4NK7QSN7THFJ4JQPYA4TFC4" }),
    ).toEqual({ kind: "merged", survivorId: "1JH4NK7QSN7THFJ4JQPYA4TFC4" });
  });

  it("returns alive when GET resolves to the same id (must not purge)", () => {
    expect(classifyDeletedCustomerResult(ID, { id: ID })).toEqual({ kind: "alive" });
  });

  it("returns unknown on a transient non-404 error (skip, let Square retry)", () => {
    expect(classifyDeletedCustomerResult(ID, undefined, { statusCode: 500 })).toEqual({
      kind: "unknown",
    });
  });
});
