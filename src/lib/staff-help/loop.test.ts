import { describe, it, expect, vi, beforeEach } from "vitest";

// The Anthropic tool-calling loop, against a stubbed API.
//
// This exists because the message protocol is fiddly in ways that only show up
// at runtime: the assistant turn has to be replayed as returned, every tool_use
// has to be answered in one following user turn, and the API rejects the
// request outright if either is wrong. Types do not catch any of that.

vi.mock("@/lib/staff/auth", () => ({ currentRole: async () => "staff" }));

// vi.mock is hoisted above the file, so the spy has to be created there too.
const { notifyStan } = vi.hoisted(() => ({
  notifyStan: vi.fn<(subject: string, body: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/staff-help/agent", () => ({ notifyStan }));

vi.mock("@/lib/staff-help/tools", () => ({
  checkPayments: async () => ({ text: "Payments look normal: 0 of 12 declined." }),
  checkPrinting: async () => ({ text: "Nothing waiting." }),
  checkStoreStatus: async () => ({ text: "Delivery is on." }),
  lookUpOrder: async () => ({ text: "OL846: 1x Milk Tea. Paid." }),
  pauseDelivery: async () => ({ text: "Delivery is paused for 2 hours.", mutated: true }),
  resumeDelivery: async () => ({ text: "Delivery is back on.", mutated: true }),
  reprintOrder: async () => ({ text: "Back in the queue.", mutated: true }),
}));

import { POST } from "@/app/api/staff/help/route";

type Body = { messages: Array<{ role: string; content: unknown }>; tools?: unknown[]; system?: string };

const calls: Body[] = [];

function reply(blocks: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: blocks }),
    text: async () => "",
  } as unknown as Response;
}

function post(text: string) {
  return new Request("http://localhost/api/staff/help", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
  });
}

beforeEach(() => {
  calls.length = 0;
  notifyStan.mockClear();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("the Claude tool loop", () => {
  it("answers a tool_use with a matching tool_result in one user turn", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Body);
      n += 1;
      if (n === 1) {
        return reply([
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_01", name: "check_payments", input: { minutes: 30 } },
        ]);
      }
      return reply([{ type: "text", text: "Payments are fine — 0 of 12 declined." }]);
    });

    const res = await POST(post("cards keep declining"));
    const json = (await res.json()) as { reply: string; performed: string[] };

    expect(json.performed).toEqual(["checked payments"]);
    expect(json.reply).toContain("0 of 12");

    // Second request: [user, assistant(with tool_use), user(tool_result)]
    const second = calls[1];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe("assistant");
    expect(second.messages[2].role).toBe("user");

    const results = second.messages[2].content as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("tool_result");
    // The id must match the tool_use it answers, or the API 400s.
    expect(results[0].tool_use_id).toBe("toolu_01");
  });

  it("answers every tool_use of a turn, not just the first", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Body);
      if (++n === 1) {
        return reply([
          { type: "tool_use", id: "toolu_a", name: "check_payments", input: {} },
          { type: "tool_use", id: "toolu_b", name: "check_printing", input: {} },
        ]);
      }
      return reply([{ type: "text", text: "Both look fine." }]);
    });

    await POST(post("everything is broken"));

    const results = calls[1].messages[2].content as Array<Record<string, unknown>>;
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_a", "toolu_b"]);
  });

  it("sends the system prompt as a field, never as a message", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Body);
      return reply([{ type: "text", text: "ok" }]);
    });

    await POST(post("hello"));

    expect(calls[0].system).toContain("Mandy's Bubble Tea");
    expect(calls[0].messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("emails Stan when a tool mutated, without the model asking", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Body);
      if (++n === 1) {
        return reply([
          { type: "tool_use", id: "t1", name: "pause_delivery", input: { hours: 2, reason: "no driver" } },
        ]);
      }
      // Deliberately says nothing about Stan: the email must not depend on it.
      return reply([{ type: "text", text: "Delivery is paused. Pickup still works." }]);
    });

    const res = await POST(post("driver quit, we cannot deliver"));
    const json = (await res.json()) as { performed: string[] };

    expect(json.performed).toEqual(["paused delivery"]);
    expect(notifyStan).toHaveBeenCalledOnce();
    expect(notifyStan.mock.calls[0][0]).toContain("paused delivery");
  });

  it("sends the email when the model claims it did but never called the tool", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Body);
      return reply([
        { type: "text", text: "I can't refund that — it's Stan's call, and he's been emailed." },
      ]);
    });

    const res = await POST(post("refund her $8"));
    const json = (await res.json()) as { performed: string[] };

    expect(notifyStan).toHaveBeenCalledOnce();
    expect(json.performed).toEqual(["emailed Stan"]);
  });

  it("degrades to a calm sentence when the API is down, and changes nothing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const res = await POST(post("cards declining"));
    const json = (await res.json()) as { reply: string; performed: string[] };

    expect(json.reply).toMatch(/call Stan/i);
    expect(json.performed).toEqual([]);
    expect(notifyStan).not.toHaveBeenCalled();
  });
});
