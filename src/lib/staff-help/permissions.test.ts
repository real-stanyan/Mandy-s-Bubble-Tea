import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAFF_TOOLS, STAFF_SYSTEM_PROMPT } from "./policy";

// The staff assistant's permission boundary, as a test rather than as a
// paragraph in the prompt.
//
// Stan approved an exact scope: diagnose freely, and change exactly three
// reversible things. That decision lives here because prompts are advice and
// this is not — a future change that widens what the assistant can do has to
// come and delete an assertion, which is a conversation, whereas a widened
// prompt is a silent one.

const ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/staff/help/route.ts"),
  "utf8",
);
const TOOLS_SRC = readFileSync(
  join(process.cwd(), "src/lib/staff-help/tools.ts"),
  "utf8",
);

const declared = STAFF_TOOLS.map((t) => t.function.name);

/** The complete list of things that write. Adding to it is the decision this
 *  file exists to make deliberate. */
const APPROVED_ACTIONS = ["pause_delivery", "resume_delivery", "reprint_order"];

describe("staff assistant permissions", () => {
  it("offers exactly the approved actions and nothing else that writes", () => {
    const actions = declared.filter(
      (n) => !n.startsWith("check_") && !n.startsWith("look_up_") && n !== "escalate_to_stan",
    );
    expect(actions.sort()).toEqual([...APPROVED_ACTIONS].sort());
  });

  it("never offers a tool that touches money", () => {
    // Not a keyword filter standing in for judgement — a tripwire. Any of
    // these words appearing in a tool name means the scope moved.
    const forbidden = /refund|price|discount|void|cancel|charge|comp|payout|transfer/i;
    for (const name of declared) {
      expect(name, `${name} looks like it moves money`).not.toMatch(forbidden);
    }
  });

  it("dispatches every declared tool, and dispatches nothing undeclared", () => {
    // A case with no schema is a capability the model can still reach by
    // naming it; a schema with no case is a promise that silently does
    // nothing. Both are bugs, in opposite directions.
    const cases = [...ROUTE.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
    expect(cases.sort()).toEqual([...declared].sort());
  });

  it("refuses unknown tool names instead of failing open", () => {
    expect(ROUTE).toMatch(/default:/);
    const tail = ROUTE.slice(ROUTE.indexOf("default:"));
    expect(tail).toMatch(/not something I can do/i);
  });

  it("tells Stan on every mutation, regardless of what the model chose", () => {
    // The notify call must be driven by the tool result, not by the model
    // picking escalate_to_stan: staff cannot audit an agent, so the record
    // cannot be opt-in.
    expect(ROUTE).toMatch(/if \(result\.mutated\)/);
    expect(ROUTE.slice(ROUTE.indexOf("if (result.mutated)"))).toMatch(/notifyStan/);
  });

  it("marks every writing tool as mutating, so none of them can skip the email", () => {
    for (const action of APPROVED_ACTIONS) {
      const fn = action.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const start = TOOLS_SRC.indexOf(`export async function ${fn}(`);
      expect(start, `${fn} not found in tools.ts`).toBeGreaterThan(-1);
      const next = TOOLS_SRC.indexOf("\nexport async function", start + 1);
      const body = TOOLS_SRC.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} never sets mutated`).toMatch(/mutated: true/);
    }
  });

  it("tells the model that escalating is a success, not a fallback", () => {
    // The failure mode this guards is a helpful model inventing a workaround
    // for a refund because refusing felt unhelpful.
    expect(STAFF_SYSTEM_PROMPT).toMatch(/escalat/i);
    expect(STAFF_SYSTEM_PROMPT).toMatch(/not a failure|good outcome/i);
  });
});
