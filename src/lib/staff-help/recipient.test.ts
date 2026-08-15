import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Where staff escalations land.
//
// This is a test rather than a comment because the two inboxes look
// interchangeable right now — PAYMENT_ALERT_TO is unset, so it and
// COMPLAINT_TO_EMAIL resolve to the same address and any mix-up is invisible.
// They stop being interchangeable the moment one is pointed at a phone to
// catch a payments outage.

const AGENT = readFileSync(join(process.cwd(), "src/lib/staff-help/agent.ts"), "utf8");

describe("the escalation recipient", () => {
  it("does not ride on the payments pager", () => {
    // Setting PAYMENT_ALERT_TO to page Rick during an outage must not silently
    // redirect every "we're out of pearls" to the same place.
    const code = AGENT.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/PAYMENT_ALERT_TO/);
  });

  it("defaults to the shop's shared inbox, overridable on its own", () => {
    expect(AGENT).toMatch(/process\.env\.STAFF_HELP_TO \?\? COMPLAINT_TO_EMAIL/);
  });
});
