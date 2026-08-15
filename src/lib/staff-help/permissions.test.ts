import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAFF_TOOLS, STAFF_SYSTEM_PROMPT, OWNER_NAME } from "./policy";

// The staff assistant's permission boundary, as a test rather than as a
// paragraph in the prompt.
//
// Rick approved an exact scope: diagnose freely, and change exactly three
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

const declared = STAFF_TOOLS.map((t) => t.name);

/** The complete list of things that write. Adding to it is the decision this
 *  file exists to make deliberate. */
const APPROVED_ACTIONS = ["pause_delivery", "resume_delivery", "reprint_order"];

describe("staff assistant permissions", () => {
  it("offers exactly the approved actions and nothing else that writes", () => {
    const actions = declared.filter(
      (n) => !n.startsWith("check_") && !n.startsWith("look_up_") && n !== "escalate_to_owner",
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

  it("tells Rick on every mutation, regardless of what the model chose", () => {
    // The notify call must be driven by the tool result, not by the model
    // picking escalate_to_owner: staff cannot audit an agent, so the record
    // cannot be opt-in.
    expect(ROUTE).toMatch(/if \(result\.mutated\)/);
    expect(ROUTE.slice(ROUTE.indexOf("if (result.mutated)"))).toMatch(/notifyOwner/);
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

  it("lets nothing else mutate, whatever it is called", () => {
    // The action check above classifies by name prefix, so a writing tool
    // named look_up_something would slip past it. This is the same rule read
    // from the other end: whatever the name, only the approved three may set
    // `mutated`, and only they can therefore trigger the email to Rick.
    const approvedFns = APPROVED_ACTIONS.map((a) =>
      a.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    );
    const exported = [...TOOLS_SRC.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    for (const fn of exported) {
      if (approvedFns.includes(fn)) continue;
      const start = TOOLS_SRC.indexOf(`export async function ${fn}(`);
      const next = TOOLS_SRC.indexOf("\nexport async function", start + 1);
      const body = TOOLS_SRC.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} mutates but is not an approved action`).not.toMatch(/mutated: true/);
    }
  });

  it("does not hand a customer's contact details to the counter", () => {
    // The customer lookup answers "is this the right person, did their order
    // go through, how many stars" and nothing else. An email or street address
    // does not help make a drink, and is worth something to whoever might be
    // standing there asking for it.
    const start = TOOLS_SRC.indexOf("export async function lookUpCustomer(");
    expect(start, "lookUpCustomer not found").toBeGreaterThan(-1);
    const next = TOOLS_SRC.indexOf("\nexport async function", start + 1);
    const body = TOOLS_SRC.slice(start, next === -1 ? undefined : next);
    for (const field of ["emailAddress", "address", "birthday", "note", "cards"]) {
      expect(body, `lookUpCustomer reads ${field}`).not.toMatch(
        new RegExp(`\\.${field}\\b`),
      );
    }
  });

  it("tells the model that escalating is a success, not a fallback", () => {
    // The failure mode this guards is a helpful model inventing a workaround
    // for a refund because refusing felt unhelpful.
    expect(STAFF_SYSTEM_PROMPT).toMatch(/escalat/i);
    expect(STAFF_SYSTEM_PROMPT).toMatch(/not a failure|good outcome/i);
  });
});

describe("the owner's name", () => {
  // Renaming Stan to Rick broke the "did it claim to have emailed him?" check
  // without failing anything: the prompt said Rick, the regex still said stan,
  // and the safety net quietly stopped catching anything. Both now read the
  // same constant, and this asserts neither has drifted back to a literal.
  it("is stated in the prompt", () => {
    expect(STAFF_SYSTEM_PROMPT).toContain(OWNER_NAME);
  });

  it("is not hard-coded into the claim check", () => {
    const claim = ROUTE.slice(ROUTE.indexOf("async function honourEmailClaim"));
    const withComments = claim.slice(0, claim.indexOf("\nexport "));
    // Comments stripped first. The name appearing in prose that explains the
    // check is fine; the name appearing in the check itself is the bug, since
    // it survives a rename and then matches nothing at all.
    const body = withComments.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).toMatch(/OWNER_NAME/);
    // A literal name here is the bug: it survives a rename and matches nothing.
    expect(body).not.toMatch(/\b(stan|rick)\b/i);
  });

  it("never leaves a stale name anywhere staff can read", () => {
    for (const src of [ROUTE, TOOLS_SRC, STAFF_SYSTEM_PROMPT]) {
      expect(src).not.toMatch(/\bStan\b/);
    }
  });
});
