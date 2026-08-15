import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the shop took is not for the counter.
//
// The staff passcode is shared, and "how much did we take today" is the one
// question this assistant could answer that nobody at the till should be able
// to ask it. How busy it has been is fine and useful; the money is not.

const TOOLS = readFileSync(join(process.cwd(), "src/lib/staff-help/tools.ts"), "utf8");
const ROUTE = readFileSync(join(process.cwd(), "src/app/api/staff/help/route.ts"), "utf8");

function bodyOf(src: string, fn: string): string {
  const start = src.indexOf(`export async function ${fn}(`);
  expect(start, `${fn} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport async function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("today's takings", () => {
  it("are composed only when the caller is allowed them", () => {
    // Not written and then left unsaid: a number that never reaches the model
    // cannot be repeated by it, however the conversation goes afterwards.
    const body = bodyOf(TOOLS, "checkToday");
    const moneyLine = body.split("\n").find((l) => l.includes("taken."));
    expect(moneyLine, "no takings line found").toBeDefined();
    const beforeMoney = body.slice(0, body.indexOf(moneyLine!));
    expect(beforeMoney).toMatch(/if \(!includeTakings\)/);
  });

  it("are decided from the passcode, not from anything the model says", () => {
    const call = ROUTE.slice(ROUTE.indexOf('case "check_today"'));
    expect(call.slice(0, 400)).toMatch(/checkToday\(role === "owner"\)/);
  });

  it("still tells staff how busy it has been", () => {
    // Removing the tool outright would have cost a real answer to a real
    // question. Only the money is held back.
    const body = bodyOf(TOOLS, "checkToday");
    expect(body).toMatch(/paid orders today, since midnight/);
  });
});
