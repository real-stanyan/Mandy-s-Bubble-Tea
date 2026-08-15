import { NextResponse } from "next/server";
import { currentRole } from "@/lib/staff/auth";
import { callDeepSeek, DeepSeekError, type DeepSeekMessage } from "@/lib/chat/deepseek";
import { STAFF_TOOLS, STAFF_SYSTEM_PROMPT } from "@/lib/staff-help/policy";
import { notifyStan } from "@/lib/staff-help/agent";
import {
  checkPayments,
  checkPrinting,
  checkStoreStatus,
  lookUpOrder,
  pauseDelivery,
  resumeDelivery,
  reprintOrder,
  type ToolResult,
} from "@/lib/staff-help/tools";

export const dynamic = "force-dynamic";

// Two rounds is enough for check-then-answer, and it bounds what one message
// can cost. A model that wants a third round has usually lost the thread.
const MAX_ROUNDS = 2;
const MAX_HISTORY = 12;

type Body = { messages?: Array<{ role: string; content: string }> };

/** Runs one named tool. The switch is the permission boundary: a tool name
 *  that is not in here does nothing, so a model that invents a tool — or is
 *  talked into naming one — gets a refusal rather than an action. */
async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult & { label: string }> {
  switch (name) {
    case "check_payments":
      return {
        ...(await checkPayments(typeof args.minutes === "number" ? args.minutes : 30)),
        label: "checked payments",
      };
    case "check_printing":
      return { ...(await checkPrinting()), label: "checked the printer" };
    case "check_store_status":
      return { ...(await checkStoreStatus()), label: "checked store status" };
    case "look_up_order":
      return {
        ...(await lookUpOrder(String(args.reference ?? ""))),
        label: `looked up ${String(args.reference ?? "")}`,
      };
    case "pause_delivery":
      return {
        ...(await pauseDelivery(
          typeof args.hours === "number" ? args.hours : 2,
          String(args.reason ?? ""),
        )),
        label: "paused delivery",
      };
    case "resume_delivery":
      return { ...(await resumeDelivery()), label: "resumed delivery" };
    case "reprint_order":
      return {
        ...(await reprintOrder(String(args.sticker_number ?? ""))),
        label: `reprinted ${String(args.sticker_number ?? "")}`,
      };
    case "escalate_to_stan": {
      const summary = String(args.summary ?? "").trim();
      if (!summary) return { text: "Nothing to send.", label: "escalation" };
      await notifyStan(
        args.urgent === true ? "URGENT from the shop" : "Message from the shop",
        `A staff member raised this through the shop assistant:\n\n${summary}\n`,
      );
      return {
        text: "Emailed Stan. Tell the customer someone will get back to them, and carry on with the queue.",
        label: "emailed Stan",
      };
    }
    default:
      return {
        text: "That is not something I can do. If it needs doing, email Stan.",
        label: "refused",
      };
  }
}

/** Roughly once in six tries the model signs off with "I've emailed Stan"
 *  without having called escalate_to_stan — observed against the real model on
 *  a double-charge question, which is exactly the kind that must not go quiet.
 *  Prompt wording does not reliably fix this, and the staff member reads the
 *  sentence, not the receipt: they tell the customer someone will be in touch,
 *  and nobody is.
 *
 *  So the server makes the claim true instead of trying to prevent it. A
 *  duplicate email to Stan costs him ten seconds; a missing one costs a
 *  customer. */
async function honourEmailClaim(
  reply: string,
  performed: string[],
  incoming: Array<{ role: string; content: string }>,
): Promise<void> {
  if (performed.includes("emailed Stan")) return;
  // Either order, because the model writes both "I've emailed Stan" and
  // "that's Stan's call, and he's been emailed". Bounded by sentence
  // punctuation so it cannot pair a verb in one sentence with a name in the
  // next — "I've emailed Stan. Tell her to wait." must match once, not twice.
  if (
    !/\b(emailed|email|messaged|contacted|told)\b[^.!?]{0,40}\bstan\b/i.test(reply) &&
    !/\bstan\b[^.!?]{0,40}\b(emailed|messaged|contacted|notified)\b/i.test(reply)
  ) {
    return;
  }
  await notifyStan("Message from the shop", [
    `The shop assistant told a staff member it had emailed you, but did not.`,
    `Sending it now so the promise holds.`,
    ``,
    `They said:`,
    incoming[incoming.length - 1]?.content ?? "(nothing recorded)",
    ``,
    `The assistant replied:`,
    reply,
  ].join("\n"));
  performed.push("emailed Stan");
}

export async function POST(req: Request) {
  const role = await currentRole();
  if (!role) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const incoming = (body.messages ?? []).slice(-MAX_HISTORY);
  if (incoming.length === 0) {
    return NextResponse.json({ ok: false, error: "no message" }, { status: 400 });
  }

  const messages: DeepSeekMessage[] = [
    { role: "system", content: STAFF_SYSTEM_PROMPT },
    ...incoming.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content ?? "").slice(0, 2000),
    })),
  ];

  // What actually happened, in the server's words. The reply the staff member
  // reads is the model's, but this is what Stan is told and what the UI shows
  // as the receipt — so a model that describes an action it did not take is
  // contradicted by the page it is speaking through.
  const performed: string[] = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await callDeepSeek(messages, { tools: [...STAFF_TOOLS], timeoutMs: 20000 });

      if (reply.toolCalls.length === 0) {
        await honourEmailClaim(reply.content, performed, incoming);
        return NextResponse.json({ ok: true, reply: reply.content, performed });
      }

      messages.push({
        role: "assistant",
        content: reply.content ?? "",
        tool_calls: reply.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      });

      for (const tc of reply.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.argumentsJson) as Record<string, unknown>;
        } catch {
          /* a malformed call runs with no arguments and the tool rejects it */
        }
        const result = await runTool(tc.name, args);
        performed.push(result.label);

        // Any change tells Stan, whether or not the model chose to. Staff have
        // no way to review what an agent did on their behalf, so the record
        // cannot be something the agent opts into.
        if (result.mutated) {
          await notifyStan(
            `Shop assistant: ${result.label}`,
            [
              `Someone at the counter used the shop assistant, and it ${result.label}.`,
              ``,
              `What it told them:`,
              result.text,
              ``,
              `They had said:`,
              incoming[incoming.length - 1]?.content ?? "(nothing recorded)",
              ``,
              `Undo it at /staff if this is wrong.`,
            ].join("\n"),
          );
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: result.text });
      }
    }

    // Out of rounds with tools still pending: answer from what we have rather
    // than leaving the staff member with a spinner.
    const final = await callDeepSeek(messages, { tools: [], timeoutMs: 20000 });
    await honourEmailClaim(final.content, performed, incoming);
    return NextResponse.json({ ok: true, reply: final.content, performed });
  } catch (err) {
    // The staff member gets a calm sentence; the reason goes to the server log,
    // because "it broke" from someone mid-service is not a bug report.
    console.error("[staff-help]", err);
    const msg =
      err instanceof DeepSeekError
        ? "I could not think that through just now — try again in a moment. If it is urgent, call Stan."
        : "Something went wrong on my side. If it is urgent, call Stan.";
    return NextResponse.json({ ok: true, reply: msg, performed });
  }
}
