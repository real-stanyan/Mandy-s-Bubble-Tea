import { describe, expect, it } from "vitest";
import { describeSendFailure } from "./send-failure";

describe("describeSendFailure", () => {
  it("keeps the Resend error code and status, not just the message", () => {
    // These three arrive with near-identical prose; the code is the only part
    // that says which one it is, and which fix applies.
    expect(
      describeSendFailure({
        name: "validation_error",
        statusCode: 403,
        message: "The mandybubbletea.com domain is not verified.",
      }),
    ).toBe(
      "validation_error 403: The mandybubbletea.com domain is not verified.",
    );

    expect(
      describeSendFailure({
        name: "restricted_api_key",
        statusCode: 401,
        message: "This API key is restricted to only send emails.",
      }),
    ).toBe(
      "restricted_api_key 401: This API key is restricted to only send emails.",
    );

    expect(
      describeSendFailure({
        name: "rate_limit_exceeded",
        statusCode: 429,
        message: "Too many requests.",
      }),
    ).toBe("rate_limit_exceeded 429: Too many requests.");
  });

  it("omits the status when Resend didn't give one", () => {
    expect(
      describeSendFailure({
        name: "application_error",
        statusCode: null,
        message: "Something went wrong.",
      }),
    ).toBe("application_error: Something went wrong.");
  });

  it("reads a thrown Error as its message, not as an error code", () => {
    // An Error also has string `name` and `message`; without the statusCode
    // check this would come back as "Error: ...".
    expect(describeSendFailure(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeSendFailure(new TypeError("bad payload"))).toBe(
      "bad payload",
    );
  });

  it("never returns an empty string", () => {
    // The UI prints this verbatim; a blank line would read as "no reason
    // given" and send whoever is debugging straight back to guessing.
    expect(describeSendFailure(undefined)).toBe("undefined");
    expect(describeSendFailure("")).toBe("Unknown error.");
  });
});
